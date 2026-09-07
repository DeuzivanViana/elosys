"""Crawler: TSE declared social media (rede_social_candidato) -> social_media.

Source zip (one per election year):
  https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/
      rede_social_candidato_{year}.zip

Since Res. TSE 23.610/2019, declaring social media / website URLs is part of
the RRC (Requerimento de Registro de Candidatura) — it is not a field in
`consulta_cand`, it is this separate file. Every row already carries the
candidacy's `SQ_CANDIDATO` (= `politician_history.tse_candidacy_id`), so
identity here is a plain lookup — no CPF fallback, no `resolve_person` needed.

This crawler is independent: `run()` wipes only what it owns (`social_media`)
and rebuilds. It reads `politician_history` to resolve `person_id`, but does
not require it to run first — a candidacy not seen there yet just gets
`person_id = NULL` and a warning.
"""

from __future__ import annotations

import csv
import io
import re
import sqlite3
import zipfile
from pathlib import Path

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
from ..util import clean_tse, now_utc

log = get_logger("elosys.tse.social")

PARSER_NAME = "tse.social"
PARSER_VERSION = "1.0"  # 1.0: social_media from rede_social_candidato

URL_TEMPLATE = (
    "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/"
    "rede_social_candidato_{year}.zip"
)
SUPPORTED_YEARS = (2018, 2020, 2022, 2024, 2026)

SOURCE = dict(
    name="TSE - rede_social_candidato",
    agency="Tribunal Superior Eleitoral",
    type="csv",
    base_url="https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/",
    legal_basis=(
        "Declaring social media / website URLs is mandatory as part of the RRC "
        "(Requerimento de Registro de Candidatura) since Res. TSE 23.610/2019 art. 26-A. "
        "Published as open data by the same resolution."
    ),
    notes="Only the URL the candidate declared to the TSE is ingested — no scraping of the "
          "profile itself, no follower/contact data.",
)

csv.field_size_limit(1 << 24)

_OWNED_TABLES = ["social_media"]

_SM_COLUMNS = (
    "person_id", "tse_candidacy_id", "year", "state", "platform", "url",
    "order_in_source", "provenance_id", "collected_at",
)

_PLATFORM_PATTERNS = (
    ("facebook", re.compile(r"facebook\.com|fb\.me", re.I)),
    ("instagram", re.compile(r"instagram\.com", re.I)),
    ("x", re.compile(r"twitter\.com|(?<![\w.])x\.com", re.I)),
    ("youtube", re.compile(r"youtube\.com|youtu\.be", re.I)),
    ("tiktok", re.compile(r"tiktok\.com", re.I)),
    ("linkedin", re.compile(r"linkedin\.com", re.I)),
    ("whatsapp", re.compile(r"wa\.me|whatsapp\.com", re.I)),
    ("telegram", re.compile(r"t\.me|telegram\.(me|org)", re.I)),
    ("kwai", re.compile(r"kwai\.com", re.I)),
)


def _g(row: dict, *names: str) -> str | None:
    for n in names:
        if n in row and row[n] is not None:
            return clean_tse(row[n])
    return None


def _platform(url: str) -> str:
    for name, pattern in _PLATFORM_PATTERNS:
        if pattern.search(url):
            return name
    return "website" if url.lower().startswith(("http://", "https://")) else "other"


def _social_members(zf: zipfile.ZipFile) -> list[str]:
    names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    brasil = [n for n in names if "_brasil" in n.lower()]
    return sorted(brasil or names)


def run(con: sqlite3.Connection, *, years: list[int] | None = None,
        tmp_dir: str | Path = "dados_tmp") -> dict:
    years = years or list(SUPPORTED_YEARS)
    unknown = [y for y in years if y not in SUPPORTED_YEARS]
    if unknown:
        raise ValueError(f"no rede_social_candidato file for: {unknown}")

    log.info("rewrite-only: social_media will contain exactly these years: %s",
             ", ".join(map(str, years)))
    with step(log, "reset social_media"):
        reset_source(con, SOURCE["name"], _OWNED_TABLES)
        con.commit()

    ph_rows = con.execute("SELECT count(*) FROM politician_history").fetchone()[0]
    if ph_rows == 0:
        log.warning("politician_history is empty — run `elosys tse-candidates` first "
                    "so social_media rows can link to a person; continuing without it")

    source_id = get_source(con, **SOURCE)
    report: dict = {"years": {}, "urls": 0, "candidacies": 0}

    for year in years:
        report["years"][year] = _ingest_year(con, year, Path(tmp_dir), source_id)

    report["urls"] = con.execute("SELECT count(*) FROM social_media").fetchone()[0]
    report["candidacies"] = con.execute(
        "SELECT count(DISTINCT tse_candidacy_id) FROM social_media").fetchone()[0]
    report["linked_to_person"] = con.execute(
        "SELECT count(*) FROM social_media WHERE person_id IS NOT NULL").fetchone()[0]
    report["by_platform"] = dict(con.execute(
        "SELECT platform, count(*) FROM social_media GROUP BY platform ORDER BY 2 DESC").fetchall())

    log.info("done: %s URLs, %s candidacies with at least one, %s linked to a person",
             f"{report['urls']:,}", f"{report['candidacies']:,}", f"{report['linked_to_person']:,}")
    return report


def _ingest_year(con: sqlite3.Connection, year: int, tmp_dir: Path, source_id: int) -> dict:
    url = URL_TEMPLATE.format(year=year)
    zip_path = tmp_dir / f"rede_social_candidato_{year}.zip"

    with step(log, f"rede social - candidatos {year}"):
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

        seen: set[tuple[str, str]] = set()
        rows: list[dict] = []
        rc = RowCounter(log, f"rede social {year}")
        with zipfile.ZipFile(zip_path) as zf:
            members = _social_members(zf)
            if not members:
                log.warning("  no rede_social_candidato file in the zip for %d", year)
                if not keep:
                    zip_path.unlink(missing_ok=True)
                return {"collection_id": collection_id, "new_urls": 0, "rows": 0}
            for name in members:
                data = zf.read(name)
                sha, fsize = sha256_bytes(data)
                file_id = record_file(con, collection_id=collection_id, filename=name,
                                      sha256=sha, size=fsize)
                parse_id = record_parse(con, collection_id=collection_id,
                                        collection_file_id=file_id, parser_name=PARSER_NAME,
                                        parser_version=PARSER_VERSION,
                                        rows_extracted=0, rows_rejected=0)
                _scan_social(data, year, seen, rows, ph_person, parse_id, rc)
                con.execute("UPDATE parse SET rows_extracted = ? WHERE id = ?", (len(rows), parse_id))
        rc.done()

        inserted = _write_rows(con, rows)
        con.commit()
        if not keep:
            zip_path.unlink(missing_ok=True)
        log.info("  %s social media URLs for %d", f"{inserted:,}", year)
        return {"collection_id": collection_id, "new_urls": inserted, "rows": rc.n}


def _scan_social(data: bytes, year: int, seen: set, rows: list, ph_person: dict,
                 parse_id: int, rc: RowCounter) -> None:
    reader = csv.DictReader(
        io.TextIOWrapper(io.BytesIO(data), encoding="latin-1", newline=""), delimiter=";")
    now = now_utc()
    for row in reader:
        rc.tick()
        sq = _g(row, "SQ_CANDIDATO")
        raw_url = _g(row, "DS_URL")
        if not sq or not raw_url:
            continue
        clean_url = raw_url.strip()
        key = (sq, clean_url)
        if key in seen:
            continue
        seen.add(key)

        order = _g(row, "NR_ORDEM_REDE_SOCIAL")
        rows.append({
            "person_id": ph_person.get(sq),
            "tse_candidacy_id": sq,
            "year": int(_g(row, "AA_ELEICAO") or year),
            "state": _g(row, "SG_UF"),
            "platform": _platform(clean_url),
            "url": clean_url,
            "order_in_source": int(order) if order and order.isdigit() else None,
            "provenance_id": parse_id,
            "collected_at": now,
        })


def _write_rows(con: sqlite3.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    before = con.execute("SELECT count(*) FROM social_media").fetchone()[0]
    sql = (f"INSERT OR IGNORE INTO social_media ({', '.join(_SM_COLUMNS)}) "
           f"VALUES ({', '.join(f':{c}' for c in _SM_COLUMNS)})")
    con.executemany(sql, rows)
    after = con.execute("SELECT count(*) FROM social_media").fetchone()[0]
    return after - before
