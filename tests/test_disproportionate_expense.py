"""Detection rule: disproportionate_expense, against synthetic campaign_expense rows."""

from __future__ import annotations

from elosys.db import connect, create_schema
from elosys.rules import disproportionate_expense as rule

T = "2026-01-01T00:00:00Z"


def _seed_common(con):
    con.execute("INSERT INTO people (cpf, cpf_trusted, canonical_name, created_at) "
                "VALUES ('11144477735', 1, 'JOAO DA SILVA', ?)", (T,))
    pid = con.execute("SELECT id FROM people").fetchone()["id"]
    con.execute("INSERT INTO companies (cnpj, kind, created_at) VALUES ('98765432000155', 'supplier', ?)", (T,))
    company_id = con.execute("SELECT id FROM companies").fetchone()["id"]
    con.execute("INSERT INTO source (name, agency, type, base_url, created_at) "
                "VALUES ('seed', 'x', 'x', 'x', ?)", (T,))
    con.execute("INSERT INTO collection (source_id, url, accessed_at, payload_sha256, size_bytes) "
                "VALUES (1, 'x', ?, 'x', 0)", (T,))
    con.execute("INSERT INTO parse (collection_id, parser_name, parser_version, run_at) "
                "VALUES (1, 'seed', '0', ?)", (T,))
    con.execute(
        "INSERT INTO campaign_org (company_id, person_id, cnpj, tse_candidacy_id, year, "
        "provenance_id, collected_at) VALUES (?, ?, '40430149000110', '250001', 2022, 1, ?)",
        (company_id, pid, T))
    org_id = con.execute("SELECT id FROM campaign_org").fetchone()["id"]
    return pid, company_id, org_id


def _insert_expense(con, org_id, company_id, description, amount_cents, expense_id):
    con.execute(
        "INSERT INTO campaign_expense (campaign_org_id, cnpj, tse_candidacy_id, year, "
        "tse_expense_id, description, amount_cents, supplier_company_id, "
        "provenance_id, collected_at) "
        "VALUES (?, '40430149000110', '250001', 2022, ?, ?, ?, ?, 1, ?)",
        (org_id, expense_id, description, amount_cents, company_id, T))


def test_flags_cheap_item_over_threshold(tmp_path):
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    pid, company_id, org_id = _seed_common(con)

    # R$ 15.000 of "canetas" -> medium (over 5k floor, under 50k)
    _insert_expense(con, org_id, company_id, "CANETAS E BLOCOS DE ANOTACAO", 1_500_000, "1")
    # R$ 1.539.000 of adhesive stickers -> high
    _insert_expense(con, org_id, company_id, "ADESIVOS, PRAGUINHA, PRAGAO, PERFURADOS", 153_900_000, "2")
    # R$ 200 of pens -> below the floor, not flagged
    _insert_expense(con, org_id, company_id, "CANETA AZUL", 20_000, "3")
    # R$ 80.000 for a car rental -> no keyword match, not flagged
    _insert_expense(con, org_id, company_id, "LOCACAO DE VEICULO PARA CAMPANHA", 8_000_000, "4")
    con.commit()

    rep = rule.run(con)
    assert rep["signals"] == 2
    assert rep["by_severity"] == {"medium": 1, "high": 1}

    signals = con.execute(
        "SELECT s.type, s.severity, s.explanation, se.record_id "
        "FROM signal s JOIN signal_evidence se ON se.signal_id = s.id "
        "ORDER BY se.record_id"
    ).fetchall()
    assert [dict(r)["severity"] for r in signals] == ["medium", "high"]
    assert all(r["type"] == "cheap_item_high_value" for r in signals)
    assert "R$" in signals[0]["explanation"]

    # actors recorded: candidate (person) and supplier (company), for the
    # first flagged expense (campaign_expense.id 1, tse_expense_id '1')
    actor_types = {
        (r["type"], r["role"]) for r in con.execute(
            "SELECT sa.type, sa.role FROM signal_actor sa "
            "JOIN signal s ON s.id = sa.signal_id "
            "JOIN signal_evidence se ON se.signal_id = s.id WHERE se.record_id = 1"
        )
    }
    assert ("person", "candidate") in actor_types
    assert ("company", "supplier") in actor_types
    con.close()


def test_evidence_traces_to_provenance(tmp_path):
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _, company_id, org_id = _seed_common(con)
    _insert_expense(con, org_id, company_id, "CRACHAS PERSONALIZADOS", 900_000, "1")
    con.commit()

    rule.run(con)
    src = con.execute(
        "SELECT src.name FROM signal_evidence se "
        "JOIN campaign_expense ce ON ce.id = se.record_id "
        "JOIN parse p ON p.id = ce.provenance_id "
        "JOIN collection c ON c.id = p.collection_id "
        "JOIN source src ON src.id = c.source_id "
        "WHERE se.table_name = 'campaign_expense'"
    ).fetchone()
    assert src["name"] == "seed"
    con.close()


def test_rewrite_only_rerun_does_not_duplicate(tmp_path):
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _, company_id, org_id = _seed_common(con)
    _insert_expense(con, org_id, company_id, "PASTAS E ENVELOPES", 900_000, "1")
    con.commit()

    rep1 = rule.run(con)
    rep2 = rule.run(con)
    assert rep1["signals"] == rep2["signals"] == 1
    assert con.execute("SELECT count(*) FROM signal").fetchone()[0] == 1
    assert con.execute("SELECT count(*) FROM rule_run").fetchone()[0] == 1
    assert con.execute("SELECT count(*) FROM signal_evidence").fetchone()[0] == 1
    con.close()


def test_never_uses_forbidden_severity_language(tmp_path):
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _, company_id, org_id = _seed_common(con)
    _insert_expense(con, org_id, company_id, "REGUAS E MARCADOR DE TEXTO", 900_000, "1")
    con.commit()
    rule.run(con)

    severities = {r["severity"] for r in con.execute("SELECT DISTINCT severity FROM signal")}
    assert severities <= {"low", "medium", "high"}
    explanations = " ".join(r["explanation"] for r in con.execute("SELECT explanation FROM signal"))
    for banned in ("CONFIRMADO", "CULPADO", "CRIME", "FRAUDE"):
        assert banned not in explanations.upper()
    con.close()
