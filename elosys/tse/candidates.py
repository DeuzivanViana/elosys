"""Collect and ingest TSE `consulta_cand` -> politician_history.

Source: https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_YYYY.zip
CSV: latin-1 encoding, ';' separator, null sentinels '#NULO#'/'#NE#'/'-N'.

LAYOUT: header with CD_*/DS_*/NM_* columns, for every supported year including
2014/2016. TSE originally published those two with a legacy header-less layout,
but has since reprocessed and republished them in the current header format
(the file we download today has DT_GERACAO stamped years after the election —
e.g. the 2014 file was regenerated in 2021). 2014 and 2016 simply carry fewer
columns than 2018+ (no DS_DETALHE_SITUACAO_CAND, no VR_DESPESA_MAX_CAMPANHA,
...) — `_g()` already tolerates a missing column (-> None), so no separate
parser is needed. Verified against the live files before enabling them here.

Two phases (rewrite-only build, see ADs/imutabilidade.md):
  1. ingest_year(): download -> record collection -> parse rows into a TEMP
     staging table (`stg_candidate`, this connection only).
  2. promote():     with all years staged, drop ambiguous CPFs, resolve identity,
                    move rows into politician_history, drop the staging table.
"""

from __future__ import annotations

import csv
import io
import sqlite3
import zipfile
from pathlib import Path

from ..identity import resolve_person
from ..log import get_logger, step
from ..provenance import (
    download,
    get_source,
    record_collection,
    record_file,
    record_parse,
    reset_source,
    sha256_bytes,
)
from ..util import clean_tse, digits_only, iso_date, normalize_name, now_utc

log = get_logger("elosys.tse.candidates")

PARSER_NAME = "tse.candidates"
PARSER_VERSION = "2.0"  # 2.0: rewrite-only build; TEMP staging; no raw_data

URL_TEMPLATE = "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_{year}.zip"
SUPPORTED_YEARS = (2014, 2016, 2018, 2020, 2022, 2024, 2026)

SOURCE = dict(
    name="TSE - consulta_cand",
    agency="Tribunal Superior Eleitoral",
    type="csv",
    base_url="https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/",
    legal_basis=(
        "Brazilian electoral open data. Candidacy registration is public "
        "(Lei 9.504/1997 art. 11; TSE open-data resolutions). CPF is a non-secret "
        "registry field (masked only in 2024, reverted for 2026)."
    ),
    notes="Candidate home address, phone and personal e-mail are protected and not ingested.",
)

csv.field_size_limit(1 << 24)

# columns written to politician_history by promote(), in order.
_PH_COLUMNS = (
    "person_id", "cpf", "cpf_trusted", "voter_id", "ballot_name", "full_name",
    "normalized_name", "tse_candidacy_id", "year", "election_type", "round", "office",
    "candidate_number", "party_abbr", "party_name", "party_number", "state",
    "electoral_unit", "municipality", "candidacy_status", "candidacy_status_detail",
    "result", "birth_date", "gender", "education", "marital_status", "race",
    "occupation", "provenance_id", "collected_at",
)
_STG_COLUMNS = tuple(c for c in _PH_COLUMNS if c not in ("person_id", "cpf_trusted"))

_STG_DDL = f"""
CREATE TEMP TABLE IF NOT EXISTS stg_candidate (
    id INTEGER PRIMARY KEY,
    {", ".join(f"{c} TEXT" for c in _STG_COLUMNS if c not in ("year", "round", "provenance_id"))},
    year INTEGER,
    round INTEGER,
    provenance_id INTEGER
)
"""


def create_staging(con: sqlite3.Connection) -> None:
    con.execute(_STG_DDL)


# Leaf tables this crawler fully owns. `people` is shared identity — not wiped
# here; resolve_person reuses existing rows by voter_id/cpf, so re-running is safe.
# Orphan `people` rows (from data that changed between runs) are harmless; a full
# clean rebuild is `rm elosys.db` + init-db + re-run every crawler.
_OWNED_TABLES = ["politician_history", "rejected_cpf"]


def run(con: sqlite3.Connection, *, years: list[int] | None = None,
        tmp_dir: str | Path = "dados_tmp") -> dict:
    """Full crawler entrypoint: wipe, stage every year, promote. Rewrite-only."""
    years = years or list(SUPPORTED_YEARS)
    log.info("rewrite-only: politician_history will contain exactly these years: %s",
             ", ".join(map(str, years)))
    with step(log, "reset politician_history + rejected_cpf"):
        reset_source(con, SOURCE["name"], _OWNED_TABLES)

    report: dict = {"years": {}}
    for year in years:
        try:
            with step(log, f"consulta_cand {year}"):
                r = ingest_year(con, year, tmp_dir)
            report["years"][year] = r
            if r.get("already_collected"):
                log.info("  %d already collected (collection %d)", year, r["collection_id"])
            else:
                log.info("  %d: staged %s rows (collection %d)",
                         year, f"{r['staged']:,}", r["collection_id"])
        except NotImplementedError as e:
            log.warning("  %d: %s", year, e)
            report["years"][year] = {"error": str(e)}

    with step(log, "promote: clean ambiguous CPFs, resolve identity, load"):
        p = promote(con)
    report["promote"] = p
    log.info("  %s rows -> politician_history; %d ambiguous CPFs dropped (%d rows)",
             f"{p['promoted']:,}", p["rejected_cpf"], p["rows_with_cpf_dropped"])
    con.execute("VACUUM")
    return report


def _g(row: dict, *names: str) -> str | None:
    for n in names:
        if n in row:
            return clean_tse(row[n])
    return None


def _int(v: str | None) -> int | None:
    try:
        return int(v) if v is not None else None
    except ValueError:
        return None


def _exact_digits(v: str | None, n: int) -> str | None:
    """digits_only, but only if it has exactly n digits (masked/partial -> None)."""
    d = digits_only(v)
    return d if d and len(d) == n else None


def _map_row(row: dict, file_year: int) -> dict:
    full_name = _g(row, "NM_CANDIDATO", "NOME_CANDIDATO")
    return {
        "cpf": _exact_digits(_g(row, "NR_CPF_CANDIDATO", "CPF_CANDIDATO"), 11),
        "voter_id": _exact_digits(_g(row, "NR_TITULO_ELEITORAL_CANDIDATO"), 12),
        "ballot_name": _g(row, "NM_URNA_CANDIDATO", "NOME_URNA_CANDIDATO"),
        "full_name": full_name,
        "normalized_name": normalize_name(full_name),
        "tse_candidacy_id": _g(row, "SQ_CANDIDATO", "SEQUENCIAL_CANDIDATO"),
        "year": int(_g(row, "ANO_ELEICAO") or file_year),
        "election_type": _g(row, "NM_TIPO_ELEICAO", "DS_ELEICAO"),
        "round": _int(_g(row, "NR_TURNO")),
        "office": _g(row, "DS_CARGO", "DESCRICAO_CARGO"),
        "candidate_number": _g(row, "NR_CANDIDATO", "NUMERO_CANDIDATO"),
        "party_abbr": _g(row, "SG_PARTIDO", "SIGLA_PARTIDO"),
        "party_name": _g(row, "NM_PARTIDO", "NOME_PARTIDO"),
        "party_number": _g(row, "NR_PARTIDO", "NUMERO_PARTIDO"),
        "state": _g(row, "SG_UF", "SIGLA_UF"),
        "electoral_unit": _g(row, "SG_UE", "SIGLA_UE"),
        "municipality": _g(row, "NM_UE", "DESCRICAO_UE"),
        "candidacy_status": _g(row, "DS_SITUACAO_CANDIDATURA", "DES_SITUACAO_CANDIDATURA"),
        "candidacy_status_detail": _g(row, "DS_DETALHE_SITUACAO_CAND"),
        "result": _g(row, "DS_SIT_TOT_TURNO", "DESC_SIT_TOT_TURNO"),
        "birth_date": iso_date(_g(row, "DT_NASCIMENTO", "DATA_NASCIMENTO")),
        "gender": _g(row, "DS_GENERO", "DESCRICAO_SEXO"),
        "education": _g(row, "DS_GRAU_INSTRUCAO", "DESCRICAO_GRAU_INSTRUCAO"),
        "marital_status": _g(row, "DS_ESTADO_CIVIL", "DESCRICAO_ESTADO_CIVIL"),
        "race": _g(row, "DS_COR_RACA"),
        "occupation": _g(row, "DS_OCUPACAO", "DESCRICAO_OCUPACAO"),
    }


def _csv_members(zf: zipfile.ZipFile) -> list[str]:
    csvs = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    brazil = [n for n in csvs if "_BRASIL" in n.upper()]
    return sorted(brazil or csvs)


def ingest_year(con: sqlite3.Connection, year: int, tmp_dir: str | Path) -> dict:
    """Download one year and stage its rows into the TEMP staging table."""
    if year not in SUPPORTED_YEARS:
        raise ValueError(f"unsupported year: {year}")

    create_staging(con)
    source_id = get_source(con, **SOURCE)
    url = URL_TEMPLATE.format(year=year)
    zip_path = Path(tmp_dir) / f"consulta_cand_{year}.zip"

    if zip_path.exists():
        # File already present (e.g. downloaded manually in a browser).
        status, ctype = None, "application/zip"
        notes = "TSE CDN; file provided locally (manual download). URL is canonical."
        keep_file = True
    else:
        status, ctype = download(url, zip_path)
        notes = "TSE CDN; the file may be re-published at the same URL."
        keep_file = False

    collection_id, is_new = record_collection(
        con, source_id=source_id, url=url, file=zip_path,
        http_status=status, content_type=ctype, notes=notes,
    )
    con.commit()
    if not is_new:
        if not keep_file:
            zip_path.unlink(missing_ok=True)
        return {"year": year, "collection_id": collection_id, "already_collected": True, "staged": 0}

    staged = 0
    with zipfile.ZipFile(zip_path) as zf:
        for name in _csv_members(zf):
            data = zf.read(name)
            sha, size = sha256_bytes(data)
            file_id = record_file(con, collection_id=collection_id, filename=name,
                                  sha256=sha, size=size)
            parse_id = record_parse(con, collection_id=collection_id, collection_file_id=file_id,
                                    parser_name=PARSER_NAME, parser_version=PARSER_VERSION,
                                    rows_extracted=0, rows_rejected=0)
            n = _stage_csv(con, data, year, parse_id)
            con.execute("UPDATE parse SET rows_extracted = ? WHERE id = ?", (n, parse_id))
            con.commit()
            staged += n

    if not keep_file:
        zip_path.unlink(missing_ok=True)
    return {"year": year, "collection_id": collection_id, "already_collected": False,
            "staged": staged}


def _stage_csv(con: sqlite3.Connection, data: bytes, file_year: int, parse_id: int) -> int:
    reader = csv.DictReader(
        io.TextIOWrapper(io.BytesIO(data), encoding="latin-1", newline=""),
        delimiter=";",
    )
    cols = _STG_COLUMNS
    placeholders = ", ".join(f":{c}" for c in cols)
    sql = f"INSERT INTO stg_candidate ({', '.join(cols)}) VALUES ({placeholders})"
    now = now_utc()
    n = 0
    for row in reader:
        m = _map_row(row, file_year)
        m["provenance_id"] = parse_id
        m["collected_at"] = now
        con.execute(sql, m)
        n += 1
    return n


def promote(con: sqlite3.Connection) -> dict:
    """Clean ambiguous CPFs, resolve identity, move staged rows into politician_history.

    Ambiguous CPF (always dropped -> NULL; the value is kept in rejected_cpf):
      - a CPF value tied to more than one distinct voter_id, or
      - a CPF whose voter_id also carries other CPFs (typo either way).
    """
    create_staging(con)
    now = now_utc()
    con.execute(
        "INSERT OR IGNORE INTO rejected_cpf "
        "(cpf, reason, distinct_voter_ids, distinct_names, recorded_at) "
        "SELECT cpf, 'multiple_voter_ids', COUNT(DISTINCT voter_id), "
        "       COUNT(DISTINCT normalized_name), ? "
        "FROM stg_candidate WHERE cpf IS NOT NULL AND voter_id IS NOT NULL "
        "GROUP BY cpf HAVING COUNT(DISTINCT voter_id) > 1",
        (now,),
    )
    con.execute(
        "INSERT OR IGNORE INTO rejected_cpf "
        "(cpf, reason, distinct_voter_ids, distinct_names, recorded_at) "
        "SELECT DISTINCT cpf, 'voter_id_multiple_cpf', 1, 1, ? "
        "FROM stg_candidate WHERE cpf IS NOT NULL AND voter_id IN ("
        "  SELECT voter_id FROM stg_candidate "
        "  WHERE cpf IS NOT NULL AND voter_id IS NOT NULL "
        "  GROUP BY voter_id HAVING COUNT(DISTINCT cpf) > 1)",
        (now,),
    )
    rejected = {r["cpf"] for r in con.execute("SELECT cpf FROM rejected_cpf")}

    insert_sql = (
        f"INSERT INTO politician_history ({', '.join(_PH_COLUMNS)}) "
        f"VALUES ({', '.join(f':{c}' for c in _PH_COLUMNS)})"
    )
    promoted = skipped = dropped_rows = 0
    for row in con.execute("SELECT * FROM stg_candidate ORDER BY id"):
        d = dict(row)
        if d["cpf"] in rejected:
            d["cpf"] = None
            dropped_rows += 1
        person_id, cpf_trusted = resolve_person(
            con, cpf=d["cpf"], voter_id=d["voter_id"], normalized_name=d["normalized_name"],
        )
        d["person_id"] = person_id
        d["cpf_trusted"] = 1 if cpf_trusted else 0
        try:
            con.execute(insert_sql, {c: d[c] for c in _PH_COLUMNS})
            promoted += 1
        except sqlite3.IntegrityError:
            skipped += 1  # (year, tse_candidacy_id, round) already in politician_history

    con.execute("DROP TABLE stg_candidate")
    con.commit()
    rejected_detail = [
        dict(r) for r in con.execute(
            "SELECT cpf, reason, distinct_voter_ids, distinct_names FROM rejected_cpf "
            "ORDER BY cpf"
        )
    ]
    return {"promoted": promoted, "skipped": skipped,
            "rejected_cpf": len(rejected), "rows_with_cpf_dropped": dropped_rows,
            "rejected_cpf_detail": rejected_detail}
