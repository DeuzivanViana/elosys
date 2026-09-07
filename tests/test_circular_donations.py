"""Detection rule: circular_donations, against synthetic campaign_donation/
campaign_expense rows -- builds tiny graphs by hand and checks the rule finds
(or correctly ignores) the loops in them."""

from __future__ import annotations

from elosys.db import connect, create_schema
from elosys.rules import circular_donations as rule

T = "2026-01-01T00:00:00Z"


def _seed_source(con):
    con.execute("INSERT INTO source (name, agency, type, base_url, created_at) "
                "VALUES ('seed', 'x', 'x', 'x', ?)", (T,))
    con.execute("INSERT INTO collection (source_id, url, accessed_at, payload_sha256, size_bytes) "
                "VALUES (1, 'x', ?, 'x', 0)", (T,))
    con.execute("INSERT INTO parse (collection_id, parser_name, parser_version, run_at) "
                "VALUES (1, 'seed', '0', ?)", (T,))


def _candidate(con, cpf, name, tse_id):
    con.execute("INSERT INTO people (cpf, cpf_trusted, canonical_name, created_at) "
                "VALUES (?, 1, ?, ?)", (cpf, name, T))
    pid = con.execute("SELECT id FROM people WHERE cpf = ?", (cpf,)).fetchone()["id"]
    con.execute("INSERT INTO companies (cnpj, kind, created_at) VALUES (?, 'campaign', ?)",
                (f"{tse_id}0000000100", T))
    company_id = con.execute("SELECT id FROM companies WHERE cnpj = ?", (f"{tse_id}0000000100",)).fetchone()["id"]
    con.execute(
        "INSERT INTO campaign_org (company_id, person_id, cnpj, tse_candidacy_id, year, "
        "provenance_id, collected_at) VALUES (?, ?, ?, ?, 2022, 1, ?)",
        (company_id, pid, f"{tse_id}0000000100", tse_id, T))
    org_id = con.execute("SELECT id FROM campaign_org WHERE tse_candidacy_id = ?", (tse_id,)).fetchone()["id"]
    return pid, org_id


def _donation(con, org_id, donor_cpf_cnpj, amount_cents, receipt_id):
    con.execute(
        "INSERT INTO campaign_donation (campaign_org_id, cnpj, year, tse_receipt_id, "
        "amount_cents, donor_cpf_cnpj, provenance_id, collected_at) "
        "VALUES (?, 'x', 2022, ?, ?, ?, 1, ?)",
        (org_id, receipt_id, amount_cents, donor_cpf_cnpj, T))


def _expense(con, org_id, supplier_cpf_cnpj, amount_cents, expense_id):
    con.execute(
        "INSERT INTO campaign_expense (campaign_org_id, cnpj, year, tse_expense_id, "
        "amount_cents, supplier_cpf_cnpj, provenance_id, collected_at) "
        "VALUES (?, 'x', 2022, ?, ?, ?, 1, ?)",
        (org_id, expense_id, amount_cents, supplier_cpf_cnpj, T))


def test_finds_two_node_cycle(tmp_path):
    """B's campaign pays A as a supplier, and separately receives a donation
    FROM A -- money went out to A and came back from A: a 2-hop loop."""
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _seed_source(con)
    donor_a = "11144477735"
    _pid_b, org_b = _candidate(con, "22255588846", "CANDIDATA B", "300001")
    _donation(con, org_b, donor_a, 10_000_00, "r1")
    _expense(con, org_b, donor_a, 8_000_00, "e1")
    con.commit()

    rep = rule.run(con)
    assert rep["cycles_found"] == 1
    assert rep["signals"] == 1

    sig = con.execute("SELECT type, severity, explanation, amount_cents, path_length FROM signal").fetchone()
    assert sig["type"] == "circular_donation"
    assert sig["severity"] == "high"  # 2-hop is <= HIGH_SEVERITY_MAX_LEN
    assert donor_a in sig["explanation"]
    assert sig["path_length"] == 2
    assert sig["amount_cents"] == 10_000_00 + 8_000_00  # donation + expense, exact sum

    evidence_tables = {
        r["table_name"] for r in con.execute(
            "SELECT se.table_name FROM signal_evidence se JOIN signal s ON s.id = se.signal_id"
        )
    }
    assert evidence_tables == {"campaign_donation", "campaign_expense"}

    actor_types = {r["type"] for r in con.execute("SELECT type FROM signal_actor")}
    assert actor_types == {"person"}
    con.close()


def test_ignores_a_straight_chain(tmp_path):
    """A -> B -> C, no edge back to A: not a cycle, nothing should be flagged."""
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _seed_source(con)
    _pid_b, org_b = _candidate(con, "22255588846", "CANDIDATA B", "300001")
    _pid_c, org_c = _candidate(con, "33366699957", "CANDIDATO C", "300002")
    _donation(con, org_b, "11144477735", 10_000_00, "r1")  # A -> B
    _donation(con, org_c, "22255588846", 5_000_00, "r2")   # B -> C
    con.commit()

    rep = rule.run(con)
    assert rep["cycles_found"] == 0
    assert rep["signals"] == 0
    con.close()


def test_max_depth_bounds_the_search(tmp_path):
    """A 6-hop cycle isn't found at the default max_depth=5, but is found
    once max_depth is raised to 6."""
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _seed_source(con)
    cpfs = ["11144477735", "22255588846", "33366699957", "44477700068", "55588811179", "66699922280"]
    org_ids = []
    for i, cpf in enumerate(cpfs):
        # Everyone is a candidate here -- the cycle wraps all the way back to
        # cpfs[0], so it too needs a campaign_org to receive the last edge.
        _pid, org_id = _candidate(con, cpf, f"CANDIDATO {i}", f"30000{i}")
        org_ids.append((cpf, org_id))
    # chain: cpfs[0] -> cpfs[1] -> ... -> cpfs[5] -> cpfs[0], all via donations
    for i in range(len(cpfs)):
        target_cpf = cpfs[(i + 1) % len(cpfs)]
        target_org = next(oid for c, oid in org_ids if c == target_cpf)
        _donation(con, target_org, cpfs[i], 1_000_00, f"r{i}")
    con.commit()

    rep_default = rule.run(con)
    assert rep_default["cycles_found"] == 0

    rep_deeper = rule.run(con, max_depth=6)
    assert rep_deeper["cycles_found"] == 1
    assert rep_deeper["signals"] == 1
    sig = con.execute("SELECT severity FROM signal").fetchone()
    assert sig["severity"] == "medium"  # 6-hop is past HIGH_SEVERITY_MAX_LEN
    con.close()


def test_rerun_is_rewrite_only(tmp_path):
    """Running twice doesn't duplicate signals -- same rewrite-only contract
    as every other rule (see disproportionate_expense)."""
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _seed_source(con)
    _pid_b, org_b = _candidate(con, "22255588846", "CANDIDATA B", "300001")
    _donation(con, org_b, "11144477735", 10_000_00, "r1")
    _expense(con, org_b, "11144477735", 8_000_00, "e1")
    con.commit()

    rule.run(con)
    rep2 = rule.run(con)
    assert rep2["signals"] == 1
    assert con.execute("SELECT count(*) FROM signal").fetchone()[0] == 1
    assert con.execute("SELECT count(*) FROM rule_run WHERE rule = 'circular_donations'").fetchone()[0] == 1
    con.close()
