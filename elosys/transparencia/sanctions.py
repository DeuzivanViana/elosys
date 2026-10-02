"""Crawler: Portal da Transparência CEIS + CNEP -> sanction."""

from __future__ import annotations

import csv
import io
import re
import sqlite3
import zipfile
from pathlib import Path

from curl_cffi import requests as curl_requests

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
from ..util import brl_to_cents, clean_tse, digits_only, iso_date, now_utc

log = get_logger("elosys.transparencia.sanctions")

PARSER_NAME = "transparencia.sanctions"
PARSER_VERSION = "1.0"

PAGE_URL_TEMPLATE = "https://portaldatransparencia.gov.br/download-de-dados/{path}"
FILE_URL_TEMPLATE = "https://portaldatransparencia.gov.br/download-de-dados/{path}/{date}"
REGISTRIES = ("ceis", "cnep")

SOURCE = dict(
    name="Portal da Transparencia - CEIS/CNEP",
    agency="Controladoria-Geral da Uniao (CGU)",
    type="csv",
    base_url="https://portaldatransparencia.gov.br/download-de-dados/",
    legal_basis=(
        "Cadastro publico de sancoes por licitacao/contrato (Lei 8.666/1993, Lei "
        "14.133/2021) e por atos de improbidade/corrupcao (Lei 8.429/1992, Lei "
        "12.846/2013 - Lei Anticorrupcao). Publicacao obrigatoria por determinacao legal."
    ),
    notes="Snapshot diario do estado atual do cadastro — nao ha historico de anos.",
)

csv.field_size_limit(1 << 24)

_OWNED_TABLES = ["sanction"]

_CEIS_COLUMNS = (
    "registry", "sanction_code", "person_type", "cpf_cnpj", "sanctioned_name",
    "sanctioned_name_reported", "legal_name", "trade_name", "process_number",
    "category", "start_date", "end_date", "publication_date", "publication",
    "publication_detail", "final_judgment_date", "scope", "sanctioning_agency",
    "agency_state", "agency_sphere", "legal_basis", "source_data_date",
    "source_origin", "notes",
)
_CNEP_COLUMNS = (
    "registry", "sanction_code", "person_type", "cpf_cnpj", "sanctioned_name",
    "sanctioned_name_reported", "legal_name", "trade_name", "process_number",
    "category", "fine_amount", "start_date", "end_date", "publication_date",
    "publication", "publication_detail", "final_judgment_date", "scope",
    "sanctioning_agency", "agency_state", "agency_sphere", "legal_basis",
    "source_data_date", "source_origin", "notes",
)

# CNEP adds VALOR DA MULTA after CATEGORIA DA SANCAO.
_SANCTION_COLUMNS = (
    "registry", "sanction_code", "person_type", "cpf_cnpj", "sanctioned_name",
    "sanctioned_name_reported", "legal_name", "trade_name", "process_number",
    "category", "fine_amount_cents", "start_date", "end_date", "publication_date",
    "publication", "publication_detail", "final_judgment_date", "scope",
    "sanctioning_agency", "agency_state", "agency_sphere", "legal_basis",
    "source_data_date", "source_origin", "notes", "company_id", "person_id",
    "provenance_id", "collected_at",
)

_DATE_FIELDS = frozenset(
    {"start_date", "end_date", "publication_date", "final_judgment_date", "source_data_date"}
)


def _discover_date(path: str) -> str:
    url = PAGE_URL_TEMPLATE.format(path=path)
    r = curl_requests.get(url, impersonate="chrome", timeout=60)
    r.raise_for_status()
    m = re.search(
        r'"ano"\s*:\s*"(\d{4})"\s*,\s*"mes"\s*:\s*"(\d{2})"\s*,\s*"dia"\s*:\s*"(\d{2})"', r.text
    )
    if not m:
        raise RuntimeError(f"could not find the current {path} file date on {url}")
    return "".join(m.groups())


def run(con: sqlite3.Connection, *, tmp_dir: str | Path = "dados_tmp") -> dict:
    with step(log, "reset sanction"):
        reset_source(con, SOURCE["name"], _OWNED_TABLES)
        con.execute("DELETE FROM companies WHERE kind = 'sanctioned'")
        con.commit()

    cpf_to_person = dict(con.execute("SELECT cpf, id FROM people WHERE cpf IS NOT NULL"))
    company_cache: dict[str, int] = {}

    source_id = get_source(con, **SOURCE)
    report: dict = {"registries": {}, "sanctions": 0, "companies": 0}

    for registry in REGISTRIES:
        report["registries"][registry] = _ingest_registry(
            con, registry, Path(tmp_dir), source_id, cpf_to_person, company_cache)

    report["sanctions"] = con.execute("SELECT count(*) FROM sanction").fetchone()[0]
    report["companies"] = con.execute(
        "SELECT count(*) FROM companies WHERE kind = 'sanctioned'").fetchone()[0]
    report["linked_to_person"] = con.execute(
        "SELECT count(*) FROM sanction WHERE person_id IS NOT NULL").fetchone()[0]
    report["linked_to_company"] = con.execute(
        "SELECT count(*) FROM sanction WHERE company_id IS NOT NULL").fetchone()[0]

    log.info("done: %s sancoes, %s empresas sancionadas, %s ja ligadas a politico conhecido",
             f"{report['sanctions']:,}", f"{report['companies']:,}", f"{report['linked_to_person']:,}")
    return report


def _ingest_registry(con: sqlite3.Connection, registry: str, tmp_dir: Path, source_id: int,
                     cpf_to_person: dict[str, int], company_cache: dict[str, int]) -> dict:
    with step(log, f"portal da transparencia - {registry.upper()}"):
        date = _discover_date(registry)
        url = FILE_URL_TEMPLATE.format(path=registry, date=date)
        zip_path = tmp_dir / f"{registry}_{date}.zip"

        log.info("  download %s", url)
        status, ctype = download(url, zip_path)
        notes = f"Portal da Transparencia; snapshot diario, capturado como {date}."

        collection_id, is_new = record_collection(
            con, source_id=source_id, url=url, file=zip_path,
            http_status=status, content_type=ctype, notes=notes)
        size = con.execute("SELECT size_bytes FROM collection WHERE id = ?",
                           (collection_id,)).fetchone()[0]
        log.info("  %s  collection %d  (%s)",
                 "new" if is_new else "already recorded", collection_id, human_bytes(size))
        con.commit()

        columns = _CNEP_COLUMNS if registry == "cnep" else _CEIS_COLUMNS
        rows_batch: list[dict] = []
        rc = RowCounter(log, registry)
        with zipfile.ZipFile(zip_path) as zf:
            members = [n for n in zf.namelist() if n.lower().endswith(".csv")]
            for name in members:
                data = zf.read(name)
                sha, fsize = sha256_bytes(data)
                file_id = record_file(con, collection_id=collection_id, filename=name,
                                      sha256=sha, size=fsize)
                parse_id = record_parse(con, collection_id=collection_id,
                                        collection_file_id=file_id, parser_name=PARSER_NAME,
                                        parser_version=PARSER_VERSION,
                                        rows_extracted=0, rows_rejected=0)
                _scan_csv(data, columns, rows_batch, cpf_to_person, company_cache,
                         con, parse_id, rc)
                con.execute("UPDATE parse SET rows_extracted = ? WHERE id = ?", (rc.n, parse_id))
        rc.done()

        inserted = _write_rows(con, rows_batch)
        con.commit()
        zip_path.unlink(missing_ok=True)
        log.info("  %s sancoes (%s)", f"{inserted:,}", registry.upper())
        return {"date": date, "collection_id": collection_id, "new_sanctions": inserted,
                "rows": rc.n}


def _scan_csv(data: bytes, columns: tuple[str, ...], rows_batch: list[dict],
              cpf_to_person: dict[str, int], company_cache: dict[str, int],
              con: sqlite3.Connection, parse_id: int, rc: RowCounter) -> None:
    reader = csv.reader(
        io.TextIOWrapper(io.BytesIO(data), encoding="latin-1", newline=""), delimiter=";")
    next(reader, None)
    now = now_utc()
    for raw in reader:
        rc.tick()
        if len(raw) != len(columns):
            continue
        row = dict(zip(columns, (clean_tse(v) for v in raw), strict=True))

        cpf_cnpj = digits_only(row.get("cpf_cnpj"))
        if not cpf_cnpj:
            continue

        person_id = None
        company_id = None
        if len(cpf_cnpj) == 11:
            person_id = cpf_to_person.get(cpf_cnpj)
        elif len(cpf_cnpj) == 14:
            company_id = _get_company(con, cpf_cnpj, company_cache)

        out = {
            "registry": row.get("registry"),
            "sanction_code": row.get("sanction_code"),
            "person_type": row.get("person_type"),
            "cpf_cnpj": cpf_cnpj,
            "sanctioned_name": row.get("sanctioned_name"),
            "sanctioned_name_reported": row.get("sanctioned_name_reported"),
            "legal_name": row.get("legal_name"),
            "trade_name": row.get("trade_name"),
            "process_number": row.get("process_number"),
            "category": row.get("category"),
            "fine_amount_cents": brl_to_cents(row.get("fine_amount")),
            "publication": row.get("publication"),
            "publication_detail": row.get("publication_detail"),
            "scope": row.get("scope"),
            "sanctioning_agency": row.get("sanctioning_agency"),
            "agency_state": row.get("agency_state"),
            "agency_sphere": row.get("agency_sphere"),
            "legal_basis": row.get("legal_basis"),
            "source_origin": row.get("source_origin"),
            "notes": row.get("notes"),
            "company_id": company_id,
            "person_id": person_id,
            "provenance_id": parse_id,
            "collected_at": now,
        }
        for f in _DATE_FIELDS:
            out[f] = iso_date(row.get(f))
        rows_batch.append(out)


def _get_company(con: sqlite3.Connection, cnpj: str, cache: dict[str, int]) -> int:
    cached = cache.get(cnpj)
    if cached is not None:
        return cached
    row = con.execute("SELECT id FROM companies WHERE cnpj = ?", (cnpj,)).fetchone()
    if row:
        cache[cnpj] = row["id"]
        return row["id"]
    cur = con.execute(
        "INSERT INTO companies (cnpj, legal_name, kind, created_at) VALUES (?, NULL, 'sanctioned', ?)",
        (cnpj, now_utc()))
    cache[cnpj] = int(cur.lastrowid)
    return cache[cnpj]


def _write_rows(con: sqlite3.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    before = con.execute("SELECT count(*) FROM sanction").fetchone()[0]
    sql = (f"INSERT OR IGNORE INTO sanction ({', '.join(_SANCTION_COLUMNS)}) "
           f"VALUES ({', '.join(f':{c}' for c in _SANCTION_COLUMNS)})")
    con.executemany(sql, rows)
    after = con.execute("SELECT count(*) FROM sanction").fetchone()[0]
    return after - before
