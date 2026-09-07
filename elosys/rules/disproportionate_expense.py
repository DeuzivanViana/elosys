"""Detection rule: despesa desproporcional — a normally-cheap item billed at
a disproportionately high value in campaign_expense.

Textbook example that triggered this rule: a candidate's real data already
had a "PAPEL, CANETA, ETIQUETA" line item and, separately, over R$ 1.5M
billed for "ADESIVOS, PRAGUINHA, PRAGAO, PERFURADOS" in a single expense.
Whether that is a legitimate bulk purchase or something worth a closer look
is exactly what this rule can't tell — it only points at the row.

Method (v1.0, keyword-based — deliberately simple and auditable):
  Flag a campaign_expense row when its free-text description (DS_DESPESA)
  mentions a normally-cheap item (caneta, adesivo, crachá, papel...) AND the
  amount contracted is above a fixed floor (see MEDIUM_FLOOR_CENTS /
  HIGH_FLOOR_CENTS below). No statistics, no learned parameters — just a
  keyword list and two thresholds, both versioned in PARAMS and stamped onto
  every rule_run row, so a signal is reproducible: same code + same data =
  same signals.

  TSE does not publish a quantity for these line items, only the total
  contracted value — so this can flag "expensive for a cheap-sounding
  category," never compute a real unit price. A future version could add a
  statistical outlier detector (compare against the median for the same
  DS_ORIGEM_DESPESA category) — not implemented here; flagged as an open
  point in ADs/dados_derivados.md.

Rewrite-only: run() deletes only the signals THIS rule produced
(rule_run.rule = 'disproportionate_expense') and regenerates them from the
current campaign_expense table. Every signal traces to its source row via
signal_evidence -> campaign_expense.provenance_id -> parse -> collection ->
source, and every one is capped at severity medium/high (see
ADs/dados_derivados.md §4) — this is a sinal de alerta, not an accusation.
"""

from __future__ import annotations

import json
import sqlite3

from ..log import RowCounter, get_logger, step
from ..util import git_commit, now_utc

log = get_logger("elosys.rules.disproportionate_expense")

RULE_NAME = "disproportionate_expense"
RULE_VERSION = "1.0"

# Cheap, everyday campaign/office-material items. Uppercase; campaign_expense
# .description is raw TSE text (not accent-stripped), so common accented
# spellings are listed alongside the bare ones.
KEYWORDS = (
    "CANETA", "LAPIS", "LÁPIS", "LAPISEIRA", "BORRACHA", "APONTADOR",
    "ADESIVO", "CRACHA", "CRACHÁ", "ETIQUETA", "CLIPS", "GRAMPO",
    "GRAMPEADOR", "REGUA", "RÉGUA", "BLOCO DE ANOTA", "ENVELOPE",
    "MARCADOR DE TEXTO", "PRANCHETA", "PERFURADOR", "ELASTICO", "ELÁSTICO",
)

# amount_cents floors -> severity. Framed as "worth checking," not a verdict:
# could be a bulk order, a bundle with unlisted items, a typo in the value.
MEDIUM_FLOOR_CENTS = 500_000     # R$ 5.000 — the row must clear this to signal at all
HIGH_FLOOR_CENTS = 5_000_000     # R$ 50.000

PARAMS = {
    "keywords": list(KEYWORDS),
    "medium_floor_cents": MEDIUM_FLOOR_CENTS,
    "high_floor_cents": HIGH_FLOOR_CENTS,
}


def _severity(amount_cents: int) -> str:
    return "high" if amount_cents >= HIGH_FLOOR_CENTS else "medium"


def run(con: sqlite3.Connection) -> dict:
    with step(log, "reset disproportionate_expense signals"):
        _reset(con)

    where_keywords = " OR ".join("ce.description LIKE ?" for _ in KEYWORDS)
    like_params = [f"%{k}%" for k in KEYWORDS]
    rows = con.execute(
        "SELECT ce.id, ce.amount_cents, ce.description, ce.year, ce.cnpj, "
        "       ce.supplier_name, ce.supplier_company_id, ce.supplier_person_id, "
        "       co.person_id AS candidate_person_id "
        "FROM campaign_expense ce "
        "LEFT JOIN campaign_org co ON co.id = ce.campaign_org_id "
        f"WHERE ce.amount_cents >= ? AND ({where_keywords})",  # noqa: S608 (keywords are a fixed constant tuple)
        [MEDIUM_FLOOR_CENTS, *like_params],
    ).fetchall()

    cur = con.execute(
        "INSERT INTO rule_run (rule, rule_version, code_commit, params, run_at, rows_generated) "
        "VALUES (?, ?, ?, ?, ?, 0)",
        (RULE_NAME, RULE_VERSION, git_commit(), json.dumps(PARAMS, ensure_ascii=False), now_utc()),
    )
    rule_run_id = int(cur.lastrowid)

    rc = RowCounter(log, "candidate expenses scanned", every=50_000)
    generated = 0
    for r in rows:
        rc.tick()
        amount = r["amount_cents"] or 0
        severity = _severity(amount)
        explanation = (
            f"Despesa de campanha de R$ {amount / 100:,.2f} descrita como "
            f'"{r["description"]}" — valor alto para um item normalmente barato. '
            "Pode ser lote com itens não detalhados na descrição, compra em grande "
            "volume, ou erro de digitação no valor; não é, por si só, indício de "
            "irregularidade."
        )
        sig_cur = con.execute(
            "INSERT INTO signal (rule_run_id, type, severity, explanation) VALUES (?, ?, ?, ?)",
            (rule_run_id, "cheap_item_high_value", severity, explanation),
        )
        signal_id = int(sig_cur.lastrowid)

        actors = []
        if r["candidate_person_id"] is not None:
            actors.append(("person", r["candidate_person_id"], "candidate"))
        if r["supplier_person_id"] is not None:
            actors.append(("person", r["supplier_person_id"], "supplier"))
        if r["supplier_company_id"] is not None:
            actors.append(("company", r["supplier_company_id"], "supplier"))
        con.executemany(
            "INSERT OR IGNORE INTO signal_actor (signal_id, type, actor_id, role) VALUES (?, ?, ?, ?)",
            [(signal_id, t, aid, role) for t, aid, role in actors],
        )
        con.execute(
            "INSERT INTO signal_evidence (signal_id, table_name, record_id) VALUES (?, 'campaign_expense', ?)",
            (signal_id, r["id"]),
        )
        generated += 1
    rc.done()

    con.execute("UPDATE rule_run SET rows_generated = ? WHERE id = ?", (generated, rule_run_id))
    con.commit()

    by_severity = dict(con.execute(
        "SELECT severity, count(*) FROM signal WHERE rule_run_id = ? GROUP BY severity",
        (rule_run_id,),
    ).fetchall())
    log.info("done: %s sinais gerados (rule_run %d) — %s",
             f"{generated:,}", rule_run_id, by_severity)
    return {"rule_run_id": rule_run_id, "signals": generated, "by_severity": by_severity}


def _reset(con: sqlite3.Connection) -> None:
    con.execute(
        "DELETE FROM signal_evidence WHERE signal_id IN "
        "(SELECT s.id FROM signal s JOIN rule_run r ON r.id = s.rule_run_id WHERE r.rule = ?)",
        (RULE_NAME,),
    )
    con.execute(
        "DELETE FROM signal_actor WHERE signal_id IN "
        "(SELECT s.id FROM signal s JOIN rule_run r ON r.id = s.rule_run_id WHERE r.rule = ?)",
        (RULE_NAME,),
    )
    con.execute(
        "DELETE FROM signal WHERE rule_run_id IN (SELECT id FROM rule_run WHERE rule = ?)",
        (RULE_NAME,),
    )
    con.execute("DELETE FROM rule_run WHERE rule = ?", (RULE_NAME,))
    con.commit()
