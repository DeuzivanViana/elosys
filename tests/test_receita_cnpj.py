"""BrasilAPI CNPJ enrichment crawler against a mocked download() (no network)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from elosys.db import connect, create_schema
from elosys.receita import cnpj as receita_cnpj

_CNPJ_OK = "13347016000117"
_CNPJ_404 = "00000000000000"

_PAYLOAD = {
    "cnpj": _CNPJ_OK,
    "razao_social": "FACEBOOK SERVICOS ONLINE DO BRASIL LTDA.",
    "nome_fantasia": "",
    "data_inicio_atividade": "2011-02-14",
    "descricao_situacao_cadastral": "ATIVA",
    "data_situacao_cadastral": "2011-02-14",
    "natureza_juridica": "Sociedade Empresaria Limitada",
    "cnae_fiscal_descricao": "Agenciamento de espacos para publicidade",
    "capital_social": 3631639,
    "porte": "DEMAIS",
    "municipio": "SAO PAULO",
    "uf": "SP",
    "qsa": [
        {
            "nome_socio": "CONRADO LEISTER",
            "cnpj_cpf_do_socio": "***634408**",
            "qualificacao_socio": "Administrador",
            "data_entrada_sociedade": "2018-11-14",
        },
        {
            "nome_socio": "FACEBOOK MIAMI, INC.",
            "cnpj_cpf_do_socio": "22576790",
            "qualificacao_socio": "Socio Pessoa Juridica Domiciliado no Exterior",
            "data_entrada_sociedade": "2015-09-17",
        },
    ],
}


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "t.db"
    create_schema(path)
    t = "2026-01-01T00:00:00Z"
    con = connect(path, write=True)
    con.execute("INSERT INTO companies (cnpj, kind, created_at) VALUES (?, 'supplier', ?)",
               (_CNPJ_OK, t))
    con.execute("INSERT INTO companies (cnpj, kind, created_at) VALUES (?, 'donor', ?)",
               (_CNPJ_404, t))
    con.commit()
    con.close()
    return path


def _fake_download_factory():
    def fake_download(url, dest):
        if _CNPJ_OK in url:
            Path(dest).write_bytes(json.dumps(_PAYLOAD).encode("utf-8"))
            return 200, "application/json"
        raise RuntimeError(f"failed to download {url}: HTTP Error 404: ")
    return fake_download


def test_fetches_registry_and_partners(db, tmp_path, monkeypatch):
    monkeypatch.setattr(receita_cnpj, "download", _fake_download_factory())
    con = connect(db, write=True)
    rep = receita_cnpj.run(con, cnpjs=[_CNPJ_OK], tmp_dir=tmp_path, delay_seconds=0)

    assert rep["fetched"] == 1
    assert rep["not_found"] == 0
    assert rep["errors"] == 0
    assert rep["total_partners"] == 2

    reg = con.execute("SELECT * FROM company_registry WHERE cnpj = ?", (_CNPJ_OK,)).fetchone()
    assert reg["legal_name"] == "FACEBOOK SERVICOS ONLINE DO BRASIL LTDA."
    assert reg["opened_at"] == "2011-02-14"
    assert reg["registry_status"] == "ATIVA"
    assert reg["share_capital_cents"] == 363163900

    partners = con.execute(
        "SELECT partner_name, role, entry_date FROM company_partner "
        "WHERE cnpj = ? ORDER BY entry_date", (_CNPJ_OK,)
    ).fetchall()
    assert [p["partner_name"] for p in partners] == ["FACEBOOK MIAMI, INC.", "CONRADO LEISTER"]
    assert partners[0]["entry_date"] == "2015-09-17"

    # provenance: company_registry -> parse -> collection -> source
    src = con.execute(
        "SELECT s.name FROM company_registry r JOIN parse p ON p.id = r.provenance_id "
        "JOIN collection c ON c.id = p.collection_id JOIN source s ON s.id = c.source_id"
    ).fetchone()
    assert src["name"] == "BrasilAPI - CNPJ"
    con.close()


def test_404_counted_as_not_found_not_error(db, tmp_path, monkeypatch):
    monkeypatch.setattr(receita_cnpj, "download", _fake_download_factory())
    con = connect(db, write=True)
    rep = receita_cnpj.run(con, cnpjs=[_CNPJ_404], tmp_dir=tmp_path, delay_seconds=0)
    assert rep["not_found"] == 1
    assert rep["errors"] == 0
    assert rep["fetched"] == 0
    con.close()


def test_never_creates_a_people_row(db, tmp_path, monkeypatch):
    # partner CPFs are masked -> no identity linking is even attempted.
    monkeypatch.setattr(receita_cnpj, "download", _fake_download_factory())
    con = connect(db, write=True)
    before = con.execute("SELECT count(*) FROM people").fetchone()[0]
    receita_cnpj.run(con, cnpjs=[_CNPJ_OK], tmp_dir=tmp_path, delay_seconds=0)
    after = con.execute("SELECT count(*) FROM people").fetchone()[0]
    assert after == before
    con.close()


def test_incremental_missing_first_queue(db, tmp_path, monkeypatch):
    """Without an explicit cnpjs= list, run() only fetches companies that
    don't already have a company_registry row -- and re-running doesn't
    re-fetch what's already cached (this crawler is NOT rewrite-only)."""
    monkeypatch.setattr(receita_cnpj, "download", _fake_download_factory())
    con = connect(db, write=True)
    rep1 = receita_cnpj.run(con, limit=10, tmp_dir=tmp_path, delay_seconds=0)
    # one company succeeds (13347016000117), one 404s (00000000000000)
    assert rep1["fetched"] == 1
    assert rep1["not_found"] == 1

    rep2 = receita_cnpj.run(con, limit=10, tmp_dir=tmp_path, delay_seconds=0)
    # the fetched one is no longer in the "missing" queue; the 404 one has no
    # cache row either way, so it's retried (and 404s again) -- fine, cheap.
    assert rep2["fetched"] == 0
    assert con.execute("SELECT count(*) FROM company_registry").fetchone()[0] == 1
    con.close()


def _seed_money_ranking(tmp_path):
    """Three supplier CNPJs paid different amounts + one campaign committee."""
    path = tmp_path / "rank.db"
    create_schema(path)
    t = "2026-01-01T00:00:00Z"
    con = connect(path, write=True)
    con.execute("INSERT INTO source (name,agency,type,base_url,created_at) VALUES ('s','x','x','x',?)", (t,))
    con.execute("INSERT INTO collection (source_id,url,accessed_at,payload_sha256,size_bytes) "
                "VALUES (1,'x',?,'x',0)", (t,))
    con.execute("INSERT INTO parse (collection_id,parser_name,parser_version,run_at) VALUES (1,'s','0',?)", (t,))
    con.execute("INSERT INTO people (cpf,cpf_trusted,canonical_name,created_at) "
                "VALUES ('11144477735',1,'X',?)", (t,))
    pid = con.execute("SELECT id FROM people").fetchone()["id"]
    con.execute("INSERT INTO companies (cnpj,kind,created_at) VALUES ('11111111000111','campaign',?)", (t,))
    camp = con.execute("SELECT id FROM companies WHERE cnpj='11111111000111'").fetchone()["id"]
    con.execute("INSERT INTO campaign_org (company_id,person_id,cnpj,tse_candidacy_id,year,provenance_id,collected_at) "
                "VALUES (?,?,'11111111000111','1',2022,1,?)", (camp, pid, t))
    org = con.execute("SELECT id FROM campaign_org").fetchone()["id"]
    for cnpj, cents in (("22222222000122", 50_000), ("33333333000133", 900_000), ("44444444000144", 10_000)):
        con.execute("INSERT INTO companies (cnpj,kind,created_at) VALUES (?,'supplier',?)", (cnpj, t))
        cid = con.execute("SELECT id FROM companies WHERE cnpj=?", (cnpj,)).fetchone()["id"]
        con.execute("INSERT INTO campaign_expense (campaign_org_id,cnpj,year,tse_expense_id,amount_cents,"
                    "supplier_cpf_cnpj,supplier_company_id,provenance_id,collected_at) "
                    "VALUES (?,'x',2022,?,?,?,?,1,?)", (org, cnpj, cents, cnpj, cid, t))
    con.commit()
    con.close()
    return path


def test_money_order_ranks_biggest_supplier_first(tmp_path, monkeypatch):
    monkeypatch.setattr(receita_cnpj, "download", _fake_download_factory())
    con = connect(_seed_money_ranking(tmp_path), write=True)

    # limit=1 must pick 33333333000133 (paid R$ 9.000), not the smaller ones
    targets = con.execute(
        receita_cnpj._MONEY_RANKED_QUERY.format(kind_filter="AND c.kind IS NOT 'campaign'"), (1,)
    ).fetchall()
    assert [r["cnpj"] for r in targets] == ["33333333000133"]

    # the campaign committee is excluded by default, included with the flag
    all_default = con.execute(
        receita_cnpj._MONEY_RANKED_QUERY.format(kind_filter="AND c.kind IS NOT 'campaign'"), (99,)
    ).fetchall()
    all_incl = con.execute(
        receita_cnpj._MONEY_RANKED_QUERY.format(kind_filter=""), (99,)
    ).fetchall()
    assert len(all_default) == 3
    assert "11111111000111" in [r["cnpj"] for r in all_incl]
    con.close()
