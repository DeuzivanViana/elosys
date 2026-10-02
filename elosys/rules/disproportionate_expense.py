"""Detection rule: despesa desproporcional — a normally-cheap item billed at"""

from __future__ import annotations

import json
import sqlite3
from statistics import median

from ..log import RowCounter, get_logger, step
from ..util import git_commit, now_utc

log = get_logger("elosys.rules.disproportionate_expense")

RULE_NAME = "disproportionate_expense"
RULE_VERSION = "2.0"

CATEGORIES: tuple[tuple[str, ...], ...] = (
    ("CANETA",),
    ("LAPIS", "LÁPIS"),
    ("LAPISEIRA",),
    ("BORRACHA",),
    ("APONTADOR",),
    ("ADESIVO",),
    ("CRACHA", "CRACHÁ"),
    ("ETIQUETA",),
    ("CLIPS",),
    ("GRAMPO",),
    ("GRAMPEADOR",),
    ("REGUA", "RÉGUA"),
    ("BLOCO DE ANOTA",),
    ("ENVELOPE",),
    ("MARCADOR DE TEXTO",),
    ("PRANCHETA",),
    ("PERFURADOR",),
    ("ELASTICO", "ELÁSTICO"),
)
KEYWORDS = tuple(spelling for cat in CATEGORIES for spelling in cat)
CANONICAL_OF = {spelling: cat[0] for cat in CATEGORIES for spelling in cat}

MIN_SAMPLE_FOR_STATS = 20
MEDIAN_MULTIPLIER_MEDIUM = 15
MEDIAN_MULTIPLIER_HIGH = 30
MIN_FLOOR_CENTS = 100_000
FALLBACK_MEDIUM_FLOOR_CENTS = 500_000
FALLBACK_HIGH_FLOOR_CENTS = 5_000_000

PARAMS = {
    "categories": [list(cat) for cat in CATEGORIES],
    "min_sample_for_stats": MIN_SAMPLE_FOR_STATS,
    "median_multiplier_medium": MEDIAN_MULTIPLIER_MEDIUM,
    "median_multiplier_high": MEDIAN_MULTIPLIER_HIGH,
    "min_floor_cents": MIN_FLOOR_CENTS,
    "fallback_medium_floor_cents": FALLBACK_MEDIUM_FLOOR_CENTS,
    "fallback_high_floor_cents": FALLBACK_HIGH_FLOOR_CENTS,
}


def _category_for(description: str) -> str | None:
    for spelling, canonical in CANONICAL_OF.items():
        if spelling in description:
            return canonical
    return None


def run(con: sqlite3.Connection) -> dict:
    with step(log, "reset disproportionate_expense signals"):
        _reset(con)

    where_keywords = " OR ".join("ce.description LIKE ?" for _ in KEYWORDS)
    like_params = [f"%{k}%" for k in KEYWORDS]
    with step(log, "scan campaign_expense for cheap-item categories"):
        rows = con.execute(
            "SELECT ce.id, ce.amount_cents, ce.description, ce.year, ce.cnpj, "
            "       ce.supplier_name, ce.supplier_company_id, ce.supplier_person_id, "
            "       co.person_id AS candidate_person_id "
            "FROM campaign_expense ce "
            "LEFT JOIN campaign_org co ON co.id = ce.campaign_org_id "
            f"WHERE ({where_keywords})",  # noqa: S608
            like_params,
        ).fetchall()

    by_category: dict[str, list[sqlite3.Row]] = {}
    for r in rows:
        cat = _category_for(r["description"])
        if cat is None:
            continue
        by_category.setdefault(cat, []).append(r)

    category_stats: dict[str, dict] = {}
    for cat, cat_rows in by_category.items():
        amounts = sorted(r["amount_cents"] or 0 for r in cat_rows)
        n = len(amounts)
        if n >= MIN_SAMPLE_FOR_STATS:
            med = median(amounts)
            medium_floor = max(MIN_FLOOR_CENTS, round(med * MEDIAN_MULTIPLIER_MEDIUM))
            high_floor = max(MIN_FLOOR_CENTS, round(med * MEDIAN_MULTIPLIER_HIGH))
        else:
            med = None
            medium_floor = FALLBACK_MEDIUM_FLOOR_CENTS
            high_floor = FALLBACK_HIGH_FLOOR_CENTS
        category_stats[cat] = {
            "n": n, "median_cents": med, "medium_floor": medium_floor, "high_floor": high_floor,
        }
        log.info(
            "  %-20s n=%6s median=%s medium>=R$%.2f high>=R$%.2f",
            cat, f"{n:,}",
            f"R${med / 100:,.2f}" if med is not None else "n/d (fallback floors)",
            medium_floor / 100, high_floor / 100,
        )

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
        cat = _category_for(r["description"])
        if cat is None:
            continue
        stats = category_stats[cat]
        amount = r["amount_cents"] or 0
        if amount < stats["medium_floor"]:
            continue
        severity = "high" if amount >= stats["high_floor"] else "medium"

        if stats["median_cents"] is not None:
            times_median = amount / stats["median_cents"] if stats["median_cents"] else None
            basis = (
                f"{times_median:.0f}x a mediana de R$ {stats['median_cents'] / 100:,.2f} "
                f"pra \"{cat.lower()}\" ({stats['n']:,} despesas nessa categoria no histórico)"
                if times_median is not None else "categoria sem mediana estável"
            )
        else:
            basis = f"categoria \"{cat.lower()}\" com poucas despesas no histórico ({stats['n']}) — piso fixo aplicado"

        explanation = (
            f"Despesa de campanha de R$ {amount / 100:,.2f} descrita como "
            f'"{r["description"]}" — {basis}. '
            "Pode ser lote com itens não detalhados na descrição, compra em grande "
            "volume, ou erro de digitação no valor; não é, por si só, indício de "
            "irregularidade."
        )
        sig_cur = con.execute(
            "INSERT INTO signal (rule_run_id, type, severity, explanation, amount_cents) VALUES (?, ?, ?, ?, ?)",
            (rule_run_id, "cheap_item_high_value", severity, explanation, amount),
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
        "DELETE FROM signal_ai_review WHERE signal_id IN "
        "(SELECT s.id FROM signal s JOIN rule_run r ON r.id = s.rule_run_id WHERE r.rule = ?)",
        (RULE_NAME,),
    )
    con.execute(
        "DELETE FROM signal WHERE rule_run_id IN (SELECT id FROM rule_run WHERE rule = ?)",
        (RULE_NAME,),
    )
    con.execute("DELETE FROM rule_run WHERE rule = ?", (RULE_NAME,))
    con.commit()
