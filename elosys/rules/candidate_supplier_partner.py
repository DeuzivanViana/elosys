"""Derived cross-reference: a CANDIDATE who is in the QUADRO SOCIETÁRIO of a
company that RECEIVED campaign money.

The Receita/BrasilAPI source masks the partner's CPF ("***498538**" -- only
the 6 middle digits show), so this can never be a deterministic identity
match (see ADs/identidade.md). It pairs:

  normalize(company_partner.partner_name) == people.canonical_name
  AND the 6 visible middle digits == the candidate's real cpf[3:9]

Even then two people could share a name and those 6 digits by chance, so a
row here is a "possível", not asserted identity: it never touches `people`
or `signal_actor`, it lives in its own table (`candidate_supplier_partner`)
with `match_basis` so the UI can flag it, and ambiguous matches (2+ people
fitting name + 6 digits) are dropped entirely.

What it surfaces: `paid_by_self = 1` means the candidate's OWN campaign paid
a company they're a partner in. `payer_candidacies > 1` (or a payer that
isn't them) means OTHER campaigns paid a politician-owned company. Either is
worth a human look -- indício, não prova.

Rewrite-only: run() wipes the table and rebuilds it from company_partner +
campaign_expense. Needs `receita-cnpj` to have populated some quadro
societário first (`company_partner`).

Run: `elosys candidate-supplier-partner --db elosys.db`.
"""

from __future__ import annotations

import sqlite3

from ..log import RowCounter, get_logger, step
from ..util import normalize_name, now_utc

log = get_logger("elosys.rules.candidate_supplier_partner")

MATCH_BASIS = "nome_e_6_digitos"
MIN_NAME_LEN = 8  # a short "J SILVA" collides with too many people


def run(con: sqlite3.Connection) -> dict:
    with step(log, "reset candidate_supplier_partner"):
        con.execute("DELETE FROM candidate_supplier_partner")
        con.commit()

    with step(log, "carregar sócios (pessoa física) de empresas que receberam pagamento"):
        partner_rows = con.execute(
            """
            SELECT DISTINCT cp.id, cp.company_id, cp.partner_name, cp.partner_doc_masked,
                            cp.role, cp.entry_date
            FROM company_partner cp
            JOIN campaign_expense e ON e.supplier_company_id = cp.company_id
            WHERE cp.partner_doc_masked LIKE '***%**'
            ORDER BY cp.entry_date
            """
        ).fetchall()
    log.info("  %s linhas de sócio pra checar", f"{len(partner_rows):,}")

    rc = RowCounter(log, "sócios checados", every=2_000)
    matched = 0
    no_match = 0
    ambiguous = 0
    seen: set[tuple[int, int]] = set()

    for pr in partner_rows:
        rc.tick()
        mask = pr["partner_doc_masked"] or ""
        visible = mask[3:9]
        if len(visible) != 6 or not visible.isdigit():
            continue
        norm = normalize_name(pr["partner_name"])
        if not norm or len(norm) < MIN_NAME_LEN or " " not in norm:
            continue

        people = con.execute(
            "SELECT id, cpf FROM people WHERE canonical_name = ? AND cpf IS NOT NULL", (norm,)
        ).fetchall()
        candidates = [p for p in people if p["cpf"][3:9] == visible]
        if not candidates:
            no_match += 1
            continue
        if len(candidates) > 1:
            ambiguous += 1
            continue

        person_id = candidates[0]["id"]
        key = (person_id, pr["company_id"])
        if key in seen:
            continue
        seen.add(key)

        agg = con.execute(
            """
            SELECT count(*) AS n, coalesce(sum(e.amount_cents), 0) AS total,
                   count(DISTINCT co.person_id) AS payers
            FROM campaign_expense e
            JOIN campaign_org co ON co.id = e.campaign_org_id
            WHERE e.supplier_company_id = ?
            """,
            (pr["company_id"],),
        ).fetchone()
        paid_by_self = con.execute(
            """
            SELECT 1 FROM campaign_expense e
            JOIN campaign_org co ON co.id = e.campaign_org_id
            WHERE e.supplier_company_id = ? AND co.person_id = ? LIMIT 1
            """,
            (pr["company_id"], person_id),
        ).fetchone()

        con.execute(
            "INSERT OR IGNORE INTO candidate_supplier_partner "
            "(person_id, company_id, company_partner_id, match_basis, partner_role, partner_since, "
            " payments_total_cents, payments_count, payer_candidacies, paid_by_self, computed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                person_id, pr["company_id"], pr["id"], MATCH_BASIS, pr["role"], pr["entry_date"],
                agg["total"], agg["n"], agg["payers"], 1 if paid_by_self else 0, now_utc(),
            ),
        )
        matched += 1
    rc.done()
    con.commit()

    by_self = con.execute(
        "SELECT paid_by_self, count(*) FROM candidate_supplier_partner GROUP BY paid_by_self"
    ).fetchall()
    log.info(
        "done: %s vínculos possíveis (%s sem match, %s ambíguos descartados) — por 'paid_by_self': %s",
        f"{matched:,}", f"{no_match:,}", f"{ambiguous:,}", dict(by_self),
    )
    return {
        "matched": matched,
        "no_match": no_match,
        "ambiguous_dropped": ambiguous,
        "by_paid_by_self": dict(by_self),
    }
