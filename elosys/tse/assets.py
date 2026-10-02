"""Crawler: TSE declared assets (bem_candidato) -> declared_assets."""

from __future__ import annotations

import csv
import io
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
from ..util import brl_to_cents, clean_tse, iso_date, now_utc

log = get_logger("elosys.tse.assets")

PARSER_NAME = "tse.assets"
PARSER_VERSION = "1.0"

URL_TEMPLATE = "https://cdn.tse.jus.br/estatistica/sead/odsele/bem_candidato/bem_candidato_{year}.zip"
SUPPORTED_YEARS = (2014, 2016, 2018, 2020, 2022, 2024, 2026)

SOURCE = dict(
    name="TSE - bem_candidato",
    agency="Tribunal Superior Eleitoral",
    type="csv",
    base_url="https://cdn.tse.jus.br/estatistica/sead/odsele/bem_candidato/",
    legal_basis=(
        "Declaring assets is mandatory at candidacy registration (Lei 9.504/1997 art. 11 "
        "§1 IV). Published as open data by TSE resolutions."
    ),
    notes="Only the declared value/description is ingested — no supporting documents.",
)

csv.field_size_limit(1 << 24)

_OWNED_TABLES = ["declared_assets"]

_DA_COLUMNS = (
    "person_id", "history_id", "tse_candidacy_id", "year", "state", "asset_order",
    "asset_type", "description", "value_cents", "source_updated_at",
    "provenance_id", "collected_at",
)


def _g(row: dict, *names: str) -> str | None:
    for n in names:
        if n in row and row[n] is not None:
            return clean_tse(row[n])
    return None


def _asset_members(zf: zipfile.ZipFile) -> list[str]:
    names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    brasil = [n for n in names if "_brasil" in n.lower()]
    return sorted(brasil or names)


def run(con: sqlite3.Connection, *, years: list[int] | None = None,
        tmp_dir: str | Path = "dados_tmp") -> dict:
    years = years or list(SUPPORTED_YEARS)
    unknown = [y for y in years if y not in SUPPORTED_YEARS]
    if unknown:
        raise ValueError(f"no bem_candidato file for: {unknown}")

    log.info("rewrite-only: declared_assets will contain exactly these years: %s",
             ", ".join(map(str, years)))
    with step(log, "reset declared_assets"):
        reset_source(con, SOURCE["name"], _OWNED_TABLES)
        con.commit()

    ph_rows = con.execute("SELECT count(*) FROM politician_history").fetchone()[0]
    if ph_rows == 0:
        log.warning("politician_history is empty — run `elosys tse-candidates` first "
                    "so declared_assets rows can link to a person; continuing without it")

    source_id = get_source(con, **SOURCE)
    report: dict = {"years": {}, "assets": 0, "candidacies": 0}

    for year in years:
        report["years"][year] = _ingest_year(con, year, Path(tmp_dir), source_id)

    report["assets"] = con.execute("SELECT count(*) FROM declared_assets").fetchone()[0]
    report["candidacies"] = con.execute(
        "SELECT count(DISTINCT tse_candidacy_id) FROM declared_assets").fetchone()[0]
    report["linked_to_person"] = con.execute(
        "SELECT count(*) FROM declared_assets WHERE person_id IS NOT NULL").fetchone()[0]
    report["total_value_cents"] = con.execute(
        "SELECT coalesce(sum(value_cents), 0) FROM declared_assets").fetchone()[0]

    log.info("done: %s assets, %s candidacies, %s linked to a person, total R$ %s",
             f"{report['assets']:,}", f"{report['candidacies']:,}", f"{report['linked_to_person']:,}",
             f"{report['total_value_cents'] / 100:,.2f}")
    return report


def _ingest_year(con: sqlite3.Connection, year: int, tmp_dir: Path, source_id: int) -> dict:
    url = URL_TEMPLATE.format(year=year)
    zip_path = tmp_dir / f"bem_candidato_{year}.zip"

    with step(log, f"bem candidato {year}"):
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

        ph_map = {
            r["tse_candidacy_id"]: (r["person_id"], r["id"])
            for r in con.execute(
                "SELECT id, tse_candidacy_id, person_id FROM politician_history WHERE year = ?", (year,)
            )
        }

        rows: list[dict] = []
        rc = RowCounter(log, f"bens {year}")
        with zipfile.ZipFile(zip_path) as zf:
            members = _asset_members(zf)
            if not members:
                log.warning("  no bem_candidato file in the zip for %d", year)
                if not keep:
                    zip_path.unlink(missing_ok=True)
                return {"collection_id": collection_id, "new_assets": 0, "rows": 0}
            for name in members:
                data = zf.read(name)
                sha, fsize = sha256_bytes(data)
                file_id = record_file(con, collection_id=collection_id, filename=name,
                                      sha256=sha, size=fsize)
                parse_id = record_parse(con, collection_id=collection_id,
                                        collection_file_id=file_id, parser_name=PARSER_NAME,
                                        parser_version=PARSER_VERSION,
                                        rows_extracted=0, rows_rejected=0)
                _scan_assets(data, year, rows, ph_map, parse_id, rc)
                con.execute("UPDATE parse SET rows_extracted = ? WHERE id = ?", (len(rows), parse_id))
        rc.done()

        inserted = _write_rows(con, rows)
        con.commit()
        if not keep:
            zip_path.unlink(missing_ok=True)
        log.info("  %s declared assets for %d", f"{inserted:,}", year)
        return {"collection_id": collection_id, "new_assets": inserted, "rows": rc.n}


def _scan_assets(data: bytes, year: int, rows: list, ph_map: dict,
                 parse_id: int, rc: RowCounter) -> None:
    reader = csv.DictReader(
        io.TextIOWrapper(io.BytesIO(data), encoding="latin-1", newline=""), delimiter=";")
    now = now_utc()
    for row in reader:
        rc.tick()
        sq = _g(row, "SQ_CANDIDATO")
        if not sq:
            continue
        order = _g(row, "NR_ORDEM_BEM_CANDIDATO")
        person_id, history_id = ph_map.get(sq, (None, None))

        rows.append({
            "person_id": person_id,
            "history_id": history_id,
            "tse_candidacy_id": sq,
            "year": int(_g(row, "ANO_ELEICAO") or year),
            "state": _g(row, "SG_UF"),
            "asset_order": int(order) if order and order.isdigit() else None,
            "asset_type": _g(row, "DS_TIPO_BEM_CANDIDATO"),
            "description": _g(row, "DS_BEM_CANDIDATO"),
            "value_cents": brl_to_cents(_g(row, "VR_BEM_CANDIDATO")),
            "source_updated_at": iso_date(_g(row, "DT_ULT_ATUAL_BEM_CANDIDATO")),
            "provenance_id": parse_id,
            "collected_at": now,
        })


def _write_rows(con: sqlite3.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    before = con.execute("SELECT count(*) FROM declared_assets").fetchone()[0]
    sql = (f"INSERT OR IGNORE INTO declared_assets ({', '.join(_DA_COLUMNS)}) "
           f"VALUES ({', '.join(f':{c}' for c in _DA_COLUMNS)})")
    con.executemany(sql, rows)
    after = con.execute("SELECT count(*) FROM declared_assets").fetchone()[0]
    return after - before
