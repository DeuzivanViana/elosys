"""candidate_supplier_partner: the fuzzy name+6-digit match against a"""

from __future__ import annotations

from elosys.db import connect, create_schema
from elosys.rules import candidate_supplier_partner as rule

T = "2026-01-01T00:00:00Z"
CPF = "12449853800"


def _seed(con):
    con.execute("INSERT INTO source (name,agency,type,base_url,created_at) VALUES ('s','x','x','x',?)", (T,))
    con.execute("INSERT INTO collection (source_id,url,accessed_at,payload_sha256,size_bytes) "
                "VALUES (1,'x',?,'x',0)", (T,))
    con.execute("INSERT INTO parse (collection_id,parser_name,parser_version,run_at) VALUES (1,'s','0',?)", (T,))
    con.execute("INSERT INTO people (cpf,cpf_trusted,canonical_name,created_at) "
                "VALUES (?,1,'BRUNA MARQUES FUTURO',?)", (CPF, T))
    pid = con.execute("SELECT id FROM people").fetchone()["id"]
    con.execute("INSERT INTO people (cpf,cpf_trusted,canonical_name,created_at) "
                "VALUES ('99988877766',1,'OUTRO CANDIDATO',?)", (T,))
    payer = con.execute("SELECT id FROM people WHERE cpf='99988877766'").fetchone()["id"]

    con.execute("INSERT INTO companies (cnpj,kind,created_at) VALUES ('11222333000181','supplier',?)", (T,))
    cid = con.execute("SELECT id FROM companies").fetchone()["id"]
    con.execute("INSERT INTO company_partner (company_id,cnpj,partner_name,partner_doc_masked,role,"
                "entry_date,provenance_id,collected_at) VALUES (?,'11222333000181','Bruna Marques Futuro',"
                "'***498538**','Administrador','2019-05-10',1,?)", (cid, T))

    con.execute("INSERT INTO campaign_org (company_id,person_id,cnpj,tse_candidacy_id,year,"
                "provenance_id,collected_at) VALUES (?,?,'40430149000110','1',2022,1,?)", (cid, payer, T))
    org = con.execute("SELECT id FROM campaign_org").fetchone()["id"]
    con.execute("INSERT INTO campaign_expense (campaign_org_id,cnpj,year,tse_expense_id,amount_cents,"
                "supplier_cpf_cnpj,supplier_company_id,provenance_id,collected_at) "
                "VALUES (?,'x',2022,'e1',5000000,'11222333000181',?,1,?)", (org, cid, T))
    con.commit()
    return pid, cid


def test_matches_partner_candidate_of_a_paid_company(tmp_path):
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    pid, cid = _seed(con)

    rep = rule.run(con)
    assert rep["matched"] == 1

    row = con.execute("SELECT * FROM candidate_supplier_partner").fetchone()
    assert row["person_id"] == pid
    assert row["company_id"] == cid
    assert row["match_basis"] == "nome_e_6_digitos"
    assert row["partner_role"] == "Administrador"
    assert row["payments_total_cents"] == 5000000
    assert row["payments_count"] == 1
    assert row["paid_by_self"] == 0
    con.close()


def test_wrong_digits_dont_match(tmp_path):
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _seed(con)
    con.execute("UPDATE company_partner SET partner_doc_masked = '***000000**'")
    con.commit()

    rep = rule.run(con)
    assert rep["matched"] == 0
    assert rep["no_match"] == 1
    con.close()


def test_ambiguous_name_and_digits_is_dropped(tmp_path):
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _seed(con)
    con.execute("INSERT INTO people (cpf,cpf_trusted,canonical_name,created_at) "
                "VALUES ('77749853811',1,'BRUNA MARQUES FUTURO',?)", (T,))
    con.commit()

    rep = rule.run(con)
    assert rep["matched"] == 0
    assert rep["ambiguous_dropped"] == 1
    con.close()


def test_rerun_is_rewrite_only(tmp_path):
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _seed(con)
    rule.run(con)
    rule.run(con)
    assert con.execute("SELECT count(*) FROM candidate_supplier_partner").fetchone()[0] == 1
    con.close()
