"""Crawler: Portal da Transparência Emendas Parlamentares -> parliamentary_earmark"""

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
from ..util import brl_to_cents, digits_only, normalize_name, now_utc

log = get_logger("elosys.transparencia.earmarks")

PARSER_NAME = "transparencia.earmarks"
PARSER_VERSION = "1.0"

FILE_URL = "https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO"

SOURCE = dict(
    name="Portal da Transparencia - Emendas Parlamentares",
    agency="Controladoria-Geral da Uniao (CGU)",
    type="csv",
    base_url="https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares",
    legal_basis=(
        "Execucao orcamentaria de emendas parlamentares individuais, de bancada e de "
        "comissao (Constituicao art. 166), publicacao obrigatoria como dado aberto."
    ),
    notes="Arquivo unico cobrindo todo o historico (2014-atual); nao ha recorte por ano na fonte.",
)

_OWNED_TABLES = ["parliamentary_earmark_beneficiary", "parliamentary_earmark"]

_EARMARK_AUTHOR_OFFICES = ("DEPUTADO FEDERAL", "SENADOR")

csv.field_size_limit(1 << 24)


def run(con: sqlite3.Connection, *, tmp_dir: str | Path = "dados_tmp") -> dict:
    with step(log, "reset parliamentary_earmark*"):
        reset_source(con, SOURCE["name"], _OWNED_TABLES)
        con.commit()

    tmp_dir = Path(tmp_dir)
    source_id = get_source(con, **SOURCE)

    author_by_name = _load_author_index(con)
    company_by_cnpj = dict(con.execute("SELECT cnpj, id FROM companies"))

    with step(log, "download emendas parlamentares (arquivo unico)"):
        zip_path = tmp_dir / "emendas_parlamentares.zip"
        status, ctype = download(FILE_URL, zip_path)
        collection_id, is_new = record_collection(
            con, source_id=source_id, url=FILE_URL, file=zip_path,
            http_status=status, content_type=ctype,
            notes="Arquivo unico, todo o historico.")
        size = con.execute("SELECT size_bytes FROM collection WHERE id = ?",
                           (collection_id,)).fetchone()[0]
        log.info("  %s  collection %d  (%s)",
                 "new" if is_new else "already recorded", collection_id, human_bytes(size))
        con.commit()

    with zipfile.ZipFile(zip_path) as zf:
        earmarks = _ingest_earmarks(con, zf, collection_id, author_by_name)
        beneficiaries = _ingest_beneficiaries(con, zf, collection_id, company_by_cnpj)
    zip_path.unlink(missing_ok=True)

    report = {
        "earmarks": earmarks,
        "beneficiaries": beneficiaries,
        "earmarks_matched_author": con.execute(
            "SELECT count(*) FROM parliamentary_earmark WHERE author_person_id IS NOT NULL"
        ).fetchone()[0],
        "beneficiaries_matched_company": con.execute(
            "SELECT count(*) FROM parliamentary_earmark_beneficiary WHERE beneficiary_company_id IS NOT NULL"
        ).fetchone()[0],
    }
    log.info("done: %s emendas (%s com autor identificado), %s linhas de favorecido "
             "(%s ja e empresa conhecida)",
             f"{report['earmarks']:,}", f"{report['earmarks_matched_author']:,}",
             f"{report['beneficiaries']:,}", f"{report['beneficiaries_matched_company']:,}")
    return report


def _load_author_index(con: sqlite3.Connection) -> dict[str, int | None]:
    placeholders = ", ".join("?" * len(_EARMARK_AUTHOR_OFFICES))
    rows = con.execute(
        f"""SELECT DISTINCT person_id, ballot_name, full_name FROM politician_history
            WHERE office IN ({placeholders})""",
        _EARMARK_AUTHOR_OFFICES,
    ).fetchall()
    by_name: dict[str, set[int]] = {}
    for person_id, ballot_name, full_name in rows:
        for n in (normalize_name(ballot_name), normalize_name(full_name)):
            if n:
                by_name.setdefault(n, set()).add(person_id)
    return {name: (next(iter(ids)) if len(ids) == 1 else None) for name, ids in by_name.items()}


def _ingest_earmarks(con: sqlite3.Connection, zf: zipfile.ZipFile, collection_id: int,
                     author_by_name: dict[str, int | None]) -> int:
    name = "EmendasParlamentares.csv"
    with step(log, name):
        data = zf.read(name)
        sha, fsize = sha256_bytes(data)
        file_id = record_file(con, collection_id=collection_id, filename=name, sha256=sha, size=fsize)
        parse_id = record_parse(con, collection_id=collection_id, collection_file_id=file_id,
                                parser_name=PARSER_NAME, parser_version=PARSER_VERSION,
                                rows_extracted=0, rows_rejected=0)

        reader = csv.DictReader(
            io.TextIOWrapper(io.BytesIO(data), encoding="latin-1", newline=""), delimiter=";")
        now = now_utc()
        rows_batch = []
        rejected = 0
        rc = RowCounter(log, "emendas")
        for row in reader:
            rc.tick()
            code = row.get("Código da Emenda")
            year_raw = row.get("Ano da Emenda")
            if not code or not year_raw or not year_raw.isdigit():
                rejected += 1
                continue
            author_name = row.get("Nome do Autor da Emenda")
            norm = normalize_name(author_name)
            author_person_id = author_by_name.get(norm) if norm else None
            rows_batch.append({
                "earmark_code": code,
                "year": int(year_raw),
                "earmark_type": row.get("Tipo de Emenda"),
                "author_code": row.get("Código do Autor da Emenda"),
                "author_name": author_name,
                "author_person_id": author_person_id,
                "author_match_basis": "nome" if author_person_id else None,
                "locality": row.get("Localidade de aplicação do recurso"),
                "state": row.get("UF"),
                "municipality": row.get("Município"),
                "function_name": row.get("Nome Função"),
                "subfunction_name": row.get("Nome Subfunção"),
                "program_name": row.get("Nome Programa"),
                "action_name": row.get("Nome Ação"),
                "committed_cents": brl_to_cents(row.get("Valor Empenhado")),
                "paid_cents": brl_to_cents(row.get("Valor Pago")),
                "provenance_id": parse_id,
                "collected_at": now,
            })
        rc.done()
        con.execute("UPDATE parse SET rows_extracted = ?, rows_rejected = ? WHERE id = ?",
                    (len(rows_batch), rejected, parse_id))

        cols = list(rows_batch[0].keys()) if rows_batch else []
        if cols:
            con.executemany(
                f"INSERT OR IGNORE INTO parliamentary_earmark ({', '.join(cols)}) "
                f"VALUES ({', '.join(f':{c}' for c in cols)})",
                rows_batch,
            )
        con.commit()
        return con.execute("SELECT count(*) FROM parliamentary_earmark").fetchone()[0]


def _ingest_beneficiaries(con: sqlite3.Connection, zf: zipfile.ZipFile, collection_id: int,
                          company_by_cnpj: dict[str, int]) -> int:
    name = "EmendasParlamentares_PorFavorecido.csv"
    with step(log, name):
        data = zf.read(name)
        sha, fsize = sha256_bytes(data)
        file_id = record_file(con, collection_id=collection_id, filename=name, sha256=sha, size=fsize)
        parse_id = record_parse(con, collection_id=collection_id, collection_file_id=file_id,
                                parser_name=PARSER_NAME, parser_version=PARSER_VERSION,
                                rows_extracted=0, rows_rejected=0)

        reader = csv.DictReader(
            io.TextIOWrapper(io.BytesIO(data), encoding="latin-1", newline=""), delimiter=";")
        now = now_utc()
        rows_batch = []
        rejected = 0
        rc = RowCounter(log, "favorecidos", every=50_000)
        BATCH = 50_000
        total_inserted = 0
        for row in reader:
            rc.tick()
            code = row.get("Código da Emenda")
            doc = digits_only(row.get("Código do Favorecido"))
            amount = brl_to_cents(row.get("Valor Recebido"))
            if not code or not doc or amount is None:
                rejected += 1
                continue
            company_id = company_by_cnpj.get(doc) if len(doc) == 14 else None
            rows_batch.append({
                "earmark_code": code,
                "author_code": row.get("Código do Autor da Emenda"),
                "year_month": row.get("Ano/Mês"),
                "beneficiary_doc": doc,
                "beneficiary_name": row.get("Favorecido"),
                "beneficiary_type": row.get("Tipo Favorecido"),
                "beneficiary_company_id": company_id,
                "state": row.get("UF Favorecido"),
                "municipality": row.get("Município Favorecido"),
                "amount_cents": amount,
                "provenance_id": parse_id,
                "collected_at": now,
            })
            if len(rows_batch) >= BATCH:
                total_inserted += _flush_beneficiaries(con, rows_batch)
                rows_batch.clear()
        total_inserted += _flush_beneficiaries(con, rows_batch)
        rc.done()
        con.execute("UPDATE parse SET rows_extracted = ?, rows_rejected = ? WHERE id = ?",
                    (total_inserted, rejected, parse_id))
        con.commit()
        return total_inserted


def _flush_beneficiaries(con: sqlite3.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    cols = list(rows[0].keys())
    con.executemany(
        f"INSERT INTO parliamentary_earmark_beneficiary ({', '.join(cols)}) "
        f"VALUES ({', '.join(f':{c}' for c in cols)})",
        rows,
    )
    con.commit()
    return len(rows)
