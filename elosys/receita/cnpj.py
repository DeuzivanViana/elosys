"""Enrichment: BrasilAPI CNPJ lookup -> company_registry + company_partner."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from ..log import RowCounter, get_logger, step
from ..provenance import download, get_source, record_collection, record_parse
from ..util import brl_to_cents, digits_only, iso_date, now_utc

log = get_logger("elosys.receita.cnpj")

PARSER_NAME = "receita.cnpj"
PARSER_VERSION = "1.0"

URL_TEMPLATE = "https://brasilapi.com.br/api/cnpj/v1/{cnpj}"
DEFAULT_LIMIT = 500
DEFAULT_ORDER = "money"
DEFAULT_DELAY_SECONDS = 0.4

_MONEY_RANKED_QUERY = """
WITH m AS (
  SELECT supplier_company_id AS cid, sum(amount_cents) AS tot
  FROM campaign_expense WHERE supplier_company_id IS NOT NULL GROUP BY supplier_company_id
  UNION ALL
  SELECT donor_company_id AS cid, sum(amount_cents) AS tot
  FROM campaign_donation WHERE donor_company_id IS NOT NULL GROUP BY donor_company_id
),
agg AS (SELECT cid, sum(tot) AS money FROM m GROUP BY cid)
SELECT c.id, c.cnpj
FROM companies c
LEFT JOIN company_registry r ON r.company_id = c.id
LEFT JOIN agg ON agg.cid = c.id
WHERE r.id IS NULL {kind_filter}
ORDER BY coalesce(agg.money, 0) DESC
LIMIT ?
"""

SOURCE = dict(
    name="BrasilAPI - CNPJ",
    agency="BrasilAPI (proxy da Receita Federal)",
    type="api",
    base_url="https://brasilapi.com.br/api/cnpj/v1/",
    legal_basis=(
        "Cadastro Nacional da Pessoa Juridica (CNPJ) e seu quadro societario sao dados "
        "publicos da Receita Federal (Lei de Acesso a Informacao, Lei 12.527/2011). "
        "BrasilAPI e um proxy publico e gratuito sobre esses dados oficiais."
    ),
    notes="Fetched incrementally, one CNPJ per HTTP request -- see schema.sql comment "
          "above company_registry for why this is not rewrite-only like the rest of elosys.",
)


def run(con: sqlite3.Connection, *, limit: int = DEFAULT_LIMIT,
        cnpjs: list[str] | None = None, tmp_dir: str | Path = "dados_tmp",
        delay_seconds: float = DEFAULT_DELAY_SECONDS, order: str = DEFAULT_ORDER,
        include_campaign: bool = False) -> dict:
    tmp_dir = Path(tmp_dir)
    source_id = get_source(con, **SOURCE)

    if cnpjs:
        wanted = [digits_only(c) for c in cnpjs]
        targets = [
            dict(r) for r in con.execute(
                f"SELECT id, cnpj FROM companies WHERE cnpj IN ({', '.join('?' * len(wanted))})",
                wanted,
            )
        ]
    elif order == "money":
        kind_filter = "" if include_campaign else "AND c.kind IS NOT 'campaign'"
        with step(log, "rankear empresas não-buscadas por dinheiro recebido/doado"):
            targets = [
                dict(r) for r in con.execute(
                    _MONEY_RANKED_QUERY.format(kind_filter=kind_filter), (limit,)
                )
            ]
    else:
        campaign_filter = "" if include_campaign else "AND c.kind IS NOT 'campaign'"
        targets = [
            dict(r) for r in con.execute(
                "SELECT c.id, c.cnpj FROM companies c "
                "LEFT JOIN company_registry r ON r.company_id = c.id "
                f"WHERE r.id IS NULL {campaign_filter} "
                "ORDER BY c.id LIMIT ?",
                (limit,),
            )
        ]

    log.info("incremental cache: %s companies to fetch this run (limit=%s, order=%s)",
             f"{len(targets):,}", "none" if cnpjs else limit, "n/a" if cnpjs else order)

    fetched = not_found = errors = 0
    rc = RowCounter(log, "cnpj lookups", every=50)
    with step(log, f"brasilapi cnpj lookups ({len(targets)})"):
        for row in targets:
            rc.tick()
            outcome = _fetch_one(con, source_id, row["id"], row["cnpj"], tmp_dir)
            if outcome == "fetched":
                fetched += 1
            elif outcome == "not_found":
                not_found += 1
            else:
                errors += 1
            if delay_seconds:
                time.sleep(delay_seconds)
        rc.done()

    remaining = con.execute(
        "SELECT count(*) FROM companies c LEFT JOIN company_registry r ON r.company_id = c.id "
        "WHERE r.id IS NULL"
    ).fetchone()[0]
    total_cached = con.execute("SELECT count(*) FROM company_registry").fetchone()[0]
    total_partners = con.execute("SELECT count(*) FROM company_partner").fetchone()[0]

    log.info("done: %s fetched, %s not found, %s errors this run — %s companies cached total "
             "(%s still missing), %s partner records",
             fetched, not_found, errors, f"{total_cached:,}", f"{remaining:,}", f"{total_partners:,}")
    return {"fetched": fetched, "not_found": not_found, "errors": errors,
            "total_cached": total_cached, "remaining": remaining, "total_partners": total_partners}


def _fetch_one(con: sqlite3.Connection, source_id: int, company_id: int, cnpj: str,
               tmp_dir: Path) -> str:
    url = URL_TEMPLATE.format(cnpj=cnpj)
    path = tmp_dir / f"brasilapi_cnpj_{cnpj}.json"
    try:
        status, ctype = download(url, path)
    except Exception as e:  # noqa: BLE001
        path.unlink(missing_ok=True)
        if "404" in str(e):
            return "not_found"
        log.warning("  %s: %s", cnpj, e)
        return "error"

    try:
        payload = json.loads(path.read_bytes())
    except (json.JSONDecodeError, OSError) as e:
        log.warning("  %s: bad response (%s)", cnpj, e)
        path.unlink(missing_ok=True)
        return "error"

    if isinstance(payload, dict) and payload.get("type") == "NOT_FOUND":
        path.unlink(missing_ok=True)
        return "not_found"

    collection_id, _ = record_collection(
        con, source_id=source_id, url=url, file=path, http_status=status, content_type=ctype,
        notes=f"BrasilAPI CNPJ lookup for {cnpj}.")
    parse_id = record_parse(con, collection_id=collection_id, parser_name=PARSER_NAME,
                            parser_version=PARSER_VERSION, rows_extracted=1, rows_rejected=0)
    _write_registry(con, company_id, cnpj, payload, parse_id)
    _write_partners(con, company_id, cnpj, payload.get("qsa") or [], parse_id)
    con.commit()
    path.unlink(missing_ok=True)
    return "fetched"


def _write_registry(con: sqlite3.Connection, company_id: int, cnpj: str, payload: dict,
                    parse_id: int) -> None:
    con.execute(
        "INSERT OR REPLACE INTO company_registry "
        "(id, company_id, cnpj, legal_name, trade_name, opened_at, registry_status, "
        " registry_status_date, legal_nature, primary_cnae, share_capital_cents, size, "
        " city, state, provenance_id, collected_at) "
        "VALUES ("
        "  (SELECT id FROM company_registry WHERE company_id = :company_id),"
        "  :company_id, :cnpj, :legal_name, :trade_name, :opened_at, :registry_status,"
        "  :registry_status_date, :legal_nature, :primary_cnae, :share_capital_cents, :size,"
        "  :city, :state, :provenance_id, :collected_at)",
        {
            "company_id": company_id,
            "cnpj": cnpj,
            "legal_name": payload.get("razao_social"),
            "trade_name": payload.get("nome_fantasia") or None,
            "opened_at": iso_date(payload.get("data_inicio_atividade")),
            "registry_status": payload.get("descricao_situacao_cadastral"),
            "registry_status_date": iso_date(payload.get("data_situacao_cadastral")),
            "legal_nature": payload.get("natureza_juridica"),
            "primary_cnae": payload.get("cnae_fiscal_descricao"),
            "share_capital_cents": brl_to_cents(str(payload.get("capital_social") or "")),
            "size": payload.get("porte"),
            "city": payload.get("municipio"),
            "state": payload.get("uf"),
            "provenance_id": parse_id,
            "collected_at": now_utc(),
        },
    )
    con.execute(
        "UPDATE companies SET legal_name = :legal_name "
        "WHERE id = :company_id AND legal_name IS NULL",
        {"legal_name": payload.get("razao_social"), "company_id": company_id},
    )


def _write_partners(con: sqlite3.Connection, company_id: int, cnpj: str, qsa: list[dict],
                    parse_id: int) -> None:
    now = now_utc()
    rows = [
        {
            "company_id": company_id,
            "cnpj": cnpj,
            "partner_name": p.get("nome_socio"),
            "partner_doc_masked": p.get("cnpj_cpf_do_socio"),
            "role": p.get("qualificacao_socio"),
            "entry_date": iso_date(p.get("data_entrada_sociedade")),
            "provenance_id": parse_id,
            "collected_at": now,
        }
        for p in qsa
        if p.get("nome_socio")
    ]
    if not rows:
        return
    con.executemany(
        "INSERT OR IGNORE INTO company_partner "
        "(company_id, cnpj, partner_name, partner_doc_masked, role, entry_date, "
        " provenance_id, collected_at) "
        "VALUES (:company_id, :cnpj, :partner_name, :partner_doc_masked, :role, :entry_date, "
        "        :provenance_id, :collected_at)",
        rows,
    )
