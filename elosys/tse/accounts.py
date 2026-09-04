"""Crawler: TSE campaign finance (prestação de contas eleitorais) -> campaign_org.

Source zip (one per election year):
  https://cdn.tse.jus.br/estatistica/sead/odsele/prestacao_contas/
      prestacao_de_contas_eleitorais_candidatos_{year}.zip

Inside, `receitas_candidatos_{year}_BRASIL.csv` (latin-1, ';') is the donations
file. Every donation row repeats the candidacy's campaign CNPJ
(`NR_CNPJ_PRESTADOR_CONTA`) and its `SQ_CANDIDATO` — the same key stored in
`politician_history.tse_candidacy_id`. This crawler streams that file and keeps
the distinct (year, candidacy, CNPJ) triples: the campaign-CNPJ map the
`consulta_cand` dataset does not carry.

The individual donations themselves (donor, amount, date) are a separate,
much larger load — a `_load_donations` step in this same module, not yet written.

This crawler is independent: `run()` wipes only what it owns
(`campaign_org`, its `companies`, its provenance rows) and rebuilds. It reads
`people` / `politician_history` produced by `tse/candidates.py` to resolve
identity, but does not require them — a candidate not seen there gets a fresh
`people` row matched by CPF.
"""

from __future__ import annotations

import csv
import io
import sqlite3
import zipfile
from pathlib import Path

from ..identity import resolve_person
from ..log import RowCounter, get_logger, human_bytes, step
from ..provenance import (
    download,
    get_source,
    record_collection,
    record_file,
    record_parse,
    reset_source,
    sha256_bytes,
)
from ..util import clean_tse, digits_only, normalize_name, now_utc

log = get_logger("elosys.tse.accounts")

PARSER_NAME = "tse.accounts"
PARSER_VERSION = "1.0"  # 1.0: campaign_org from receitas_candidatos

URL_TEMPLATE = (
    "https://cdn.tse.jus.br/estatistica/sead/odsele/prestacao_contas/"
    "prestacao_de_contas_eleitorais_candidatos_{year}.zip"
)
SUPPORTED_YEARS = (2018, 2020, 2022, 2024, 2026)

SOURCE = dict(
    name="TSE - prestacao_contas",
    agency="Tribunal Superior Eleitoral",
    type="csv",
    base_url="https://cdn.tse.jus.br/estatistica/sead/odsele/prestacao_contas/",
    legal_basis=(
        "Brazilian electoral open data. Campaign finance reporting is public "
        "(Lei 9.504/1997 arts. 28–32; TSE open-data resolutions). The campaign "
        "CNPJ is a public registry identifier (Receita natureza jurídica 409-4)."
    ),
    notes="Donor home address and contact are not published here and are not ingested.",
)

csv.field_size_limit(1 << 24)

_OWNED_TABLES = ["campaign_org"]

_ORG_COLUMNS = (
    "company_id", "person_id", "cnpj", "tse_candidacy_id", "accountant_id", "year",
    "candidate_cpf", "candidate_name", "normalized_name", "office", "party_abbr",
    "state", "provenance_id", "collected_at",
)


def _g(row: dict, *names: str) -> str | None:
    for n in names:
        if n in row and row[n] is not None:
            return clean_tse(row[n])
    return None


def _digits(v: str | None, n: int) -> str | None:
    d = digits_only(v)
    return d if d and len(d) == n else None


def _receitas_members(zf: zipfile.ZipFile) -> list[str]:
    names = [
        n for n in zf.namelist()
        if n.lower().endswith(".csv")
        and "receitas_candidatos_" in n.lower()
        and "doador_originario" not in n.lower()
    ]
    brasil = [n for n in names if "_brasil" in n.lower()]
    return sorted(brasil or names)


def run(con: sqlite3.Connection, *, years: list[int] | None = None,
        tmp_dir: str | Path = "dados_tmp") -> dict:
    years = years or list(SUPPORTED_YEARS)
    unknown = [y for y in years if y not in SUPPORTED_YEARS]
    if unknown:
        raise ValueError(f"no prestação de contas file for: {unknown}")

    log.info("rewrite-only: campaign_org will contain exactly these years: %s",
             ", ".join(map(str, years)))
    with step(log, "reset campaign_org"):
        reset_source(con, SOURCE["name"], _OWNED_TABLES)
        con.execute("DELETE FROM companies WHERE kind = 'campaign'")
        con.commit()

    ph_rows = con.execute("SELECT count(*) FROM politician_history").fetchone()[0]
    if ph_rows == 0:
        log.warning("politician_history is empty — run `elosys tse-candidates` first "
                    "for identity to link up; continuing with CPF-only matching")
    rejected_cpf = {r["cpf"] for r in con.execute("SELECT cpf FROM rejected_cpf")}

    source_id = get_source(con, **SOURCE)
    report: dict = {"years": {}, "orgs": 0, "companies": 0}

    for year in years:
        report["years"][year] = _ingest_year(con, year, Path(tmp_dir), source_id, rejected_cpf)

    report["orgs"] = con.execute("SELECT count(*) FROM campaign_org").fetchone()[0]
    report["companies"] = con.execute(
        "SELECT count(*) FROM companies WHERE kind = 'campaign'").fetchone()[0]
    report["orgs_linked_to_person"] = con.execute(
        "SELECT count(*) FROM campaign_org WHERE person_id IS NOT NULL").fetchone()[0]

    log.info("done: %s campaign CNPJs, %s companies, %s linked to a person",
             f"{report['orgs']:,}", f"{report['companies']:,}",
             f"{report['orgs_linked_to_person']:,}")
    return report


def _ingest_year(con: sqlite3.Connection, year: int, tmp_dir: Path,
                 source_id: int, rejected_cpf: set[str]) -> dict:
    url = URL_TEMPLATE.format(year=year)
    zip_path = tmp_dir / f"prestacao_contas_candidatos_{year}.zip"

    with step(log, f"prestacao de contas - candidatos {year}"):
        if zip_path.exists():
            status, ctype, keep = None, "application/zip", True
            notes = "TSE CDN; file provided locally. URL is canonical."
            log.info("  using local file %s", zip_path)
        else:
            log.info("  download %s", url)
            status, ctype = download(url, zip_path)
            keep = False
            notes = "TSE CDN; the file may be re-published at the same URL."

        collection_id, is_new = record_collection(
            con, source_id=source_id, url=url, file=zip_path,
            http_status=status, content_type=ctype, notes=notes)
        size = con.execute("SELECT size_bytes FROM collection WHERE id = ?",
                           (collection_id,)).fetchone()[0]
        log.info("  %s  collection %d  (%s)",
                 "new" if is_new else "already recorded", collection_id, human_bytes(size))
        con.commit()

        ph_person = dict(con.execute(
            "SELECT tse_candidacy_id, person_id FROM politician_history WHERE year = ?", (year,)
        ).fetchall())

        seen: set[tuple[str | None, str]] = set()
        orgs: list[dict] = []
        rc = RowCounter(log, f"receitas {year}")
        with zipfile.ZipFile(zip_path) as zf:
            members = _receitas_members(zf)
            if not members:
                log.warning("  no receitas_candidatos file in the zip for %d", year)
                if not keep:
                    zip_path.unlink(missing_ok=True)
                return {"collection_id": collection_id, "new_orgs": 0, "rows": 0}
            for name in members:
                data = zf.read(name)
                sha, fsize = sha256_bytes(data)
                file_id = record_file(con, collection_id=collection_id, filename=name,
                                      sha256=sha, size=fsize)
                parse_id = record_parse(con, collection_id=collection_id,
                                        collection_file_id=file_id, parser_name=PARSER_NAME,
                                        parser_version=PARSER_VERSION,
                                        rows_extracted=0, rows_rejected=0)
                _scan_receitas(data, year, seen, orgs, ph_person, rejected_cpf, parse_id, rc, con)
                con.execute("UPDATE parse SET rows_extracted = ? WHERE id = ?", (len(orgs), parse_id))
        rc.done()

        inserted = _write_orgs(con, orgs)
        con.commit()
        if not keep:
            zip_path.unlink(missing_ok=True)
        log.info("  %s campaign CNPJs for %d", f"{inserted:,}", year)
        return {"collection_id": collection_id, "new_orgs": inserted, "rows": rc.n}


def _scan_receitas(data: bytes, year: int, seen: set, orgs: list, ph_person: dict,
                   rejected_cpf: set[str], parse_id: int, rc: RowCounter,
                   con: sqlite3.Connection) -> None:
    reader = csv.DictReader(
        io.TextIOWrapper(io.BytesIO(data), encoding="latin-1", newline=""), delimiter=";")
    now = now_utc()
    for row in reader:
        rc.tick()
        cnpj = _digits(_g(row, "NR_CNPJ_PRESTADOR_CONTA"), 14)
        sq = _g(row, "SQ_CANDIDATO")
        if not cnpj:
            continue
        key = (sq, cnpj)
        if key in seen:
            continue
        seen.add(key)

        cpf = _digits(_g(row, "NR_CPF_CANDIDATO"), 11)
        if cpf in rejected_cpf:
            cpf = None
        name = _g(row, "NM_CANDIDATO")
        norm = normalize_name(name)

        person_id = ph_person.get(sq)
        if person_id is None:
            person_id, _ = resolve_person(con, cpf=cpf, voter_id=None, normalized_name=norm)

        company_id = _get_company(con, cnpj)
        orgs.append({
            "company_id": company_id,
            "person_id": person_id,
            "cnpj": cnpj,
            "tse_candidacy_id": sq,
            "accountant_id": _g(row, "SQ_PRESTADOR_CONTAS"),
            "year": int(_g(row, "AA_ELEICAO") or year),
            "candidate_cpf": cpf,
            "candidate_name": name,
            "normalized_name": norm,
            "office": _g(row, "DS_CARGO"),
            "party_abbr": _g(row, "SG_PARTIDO"),
            "state": _g(row, "SG_UF"),
            "provenance_id": parse_id,
            "collected_at": now,
        })


def _get_company(con: sqlite3.Connection, cnpj: str) -> int:
    row = con.execute("SELECT id FROM companies WHERE cnpj = ?", (cnpj,)).fetchone()
    if row:
        return row["id"]
    cur = con.execute(
        "INSERT INTO companies (cnpj, legal_name, kind, created_at) VALUES (?, NULL, 'campaign', ?)",
        (cnpj, now_utc()))
    return int(cur.lastrowid)


def _write_orgs(con: sqlite3.Connection, orgs: list[dict]) -> int:
    if not orgs:
        return 0
    before = con.execute("SELECT count(*) FROM campaign_org").fetchone()[0]
    sql = (f"INSERT OR IGNORE INTO campaign_org ({', '.join(_ORG_COLUMNS)}) "
           f"VALUES ({', '.join(f':{c}' for c in _ORG_COLUMNS)})")
    con.executemany(sql, orgs)
    after = con.execute("SELECT count(*) FROM campaign_org").fetchone()[0]
    return after - before
