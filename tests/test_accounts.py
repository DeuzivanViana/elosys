"""TSE prestação de contas crawler (campaign_org + campaign_donation +"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from elosys.db import connect, create_schema
from elosys.tse import accounts

_CPF = "11144477735"
_CNPJ = "40430149000110"
_SQ = "250000900001"

_DONOR_CPF = "12345678909"
_DONOR_CNPJ = "98765432000155"
_OTHER_CANDIDATE_SQ = "250000900099"

_SUPPLIER_CPF = "45612378900"
_SUPPLIER_CNPJ = "11222333000181"

DON_HEADER = (
    "AA_ELEICAO;SG_UF;SQ_PRESTADOR_CONTAS;NR_CNPJ_PRESTADOR_CONTA;DS_CARGO;"
    "SQ_CANDIDATO;NR_CANDIDATO;NM_CANDIDATO;NR_CPF_CANDIDATO;NR_PARTIDO;SG_PARTIDO;"
    "NM_PARTIDO;DS_FONTE_RECEITA;DS_ORIGEM_RECEITA;DS_ESPECIE_RECEITA;"
    "NR_CPF_CNPJ_DOADOR;NM_DOADOR;NM_DOADOR_RFB;DS_CNAE_DOADOR;SG_UF_DOADOR;"
    "NM_MUNICIPIO_DOADOR;SQ_CANDIDATO_DOADOR;SG_PARTIDO_DOADOR;NR_RECIBO_DOACAO;"
    "NR_DOCUMENTO_DOACAO;SQ_RECEITA;DT_RECEITA;VR_RECEITA"
)

EXP_HEADER = (
    "AA_ELEICAO;SG_UF;SQ_PRESTADOR_CONTAS;NR_CNPJ_PRESTADOR_CONTA;DS_CARGO;"
    "SQ_CANDIDATO;NR_CANDIDATO;NM_CANDIDATO;NR_CPF_CANDIDATO;NR_PARTIDO;SG_PARTIDO;"
    "NM_PARTIDO;DS_TIPO_FORNECEDOR;DS_CNAE_FORNECEDOR;NR_CPF_CNPJ_FORNECEDOR;"
    "NM_FORNECEDOR;NM_FORNECEDOR_RFB;SG_UF_FORNECEDOR;NM_MUNICIPIO_FORNECEDOR;"
    "SQ_CANDIDATO_FORNECEDOR;SG_PARTIDO_FORNECEDOR;DS_TIPO_DOCUMENTO;NR_DOCUMENTO;"
    "DS_ORIGEM_DESPESA;SQ_DESPESA;DT_DESPESA;DS_DESPESA;VR_DESPESA_CONTRATADA"
)


def _receita(sq_receita, valor, doador, nome_doador, doador_candidato="-1", cnae="#NULO#"):
    return (
        f"2022;SP;9911;{_CNPJ};DEPUTADO FEDERAL;{_SQ};1234;JOAO DA SILVA;{_CPF};13;PT;"
        f"PARTIDO;OUTROS RECURSOS;Recursos de pessoas fisicas;PIX;"
        f"{doador};{nome_doador};{nome_doador};{cnae};SP;SAO PAULO;{doador_candidato};"
        f"#NULO#;#NULO#;DOCXYZ;{sq_receita};13/09/2022;{valor}"
    )


def _despesa(sq_despesa, valor, fornecedor, nome_fornecedor, tipo, fornecedor_candidato="-1",
            cnae="#NULO#"):
    return (
        f"2022;SP;9911;{_CNPJ};DEPUTADO FEDERAL;{_SQ};1234;JOAO DA SILVA;{_CPF};13;PT;"
        f"PARTIDO;{tipo};{cnae};{fornecedor};{nome_fornecedor};{nome_fornecedor};SP;SAO PAULO;"
        f"{fornecedor_candidato};#NULO#;NOTA FISCAL;NFXYZ;Divulgacao de campanha;"
        f"{sq_despesa};14/09/2022;IMPULSIONAMENTO;{valor}"
    )


DON_LINES = [
    _receita("1", "1000,00", _DONOR_CPF, "FULANO CIDADAO"),
    _receita("2", "250,50", _DONOR_CNPJ, "EMPRESA X LTDA", cnae="6201-5/01"),
    _receita("3", "500,00", "10000000000", "OUTRO CANDIDATO", doador_candidato=_OTHER_CANDIDATE_SQ),
    _receita("1", "1000,00", _DONOR_CPF, "FULANO CIDADAO"),
]

EXP_LINES = [
    _despesa("101", "800,00", _SUPPLIER_CNPJ, "AGENCIA DE MARKETING LTDA", "PESSOA JURIDICA",
             cnae="7311-4/00"),
    _despesa("102", "300,00", _SUPPLIER_CPF, "FOTOGRAFO FREELANCER", "PESSOA FISICA"),
    _despesa("103", "150,00", "10000000000", "OUTRO CANDIDATO", "PESSOA FISICA",
             fornecedor_candidato=_OTHER_CANDIDATE_SQ),
    _despesa("101", "800,00", _SUPPLIER_CNPJ, "AGENCIA DE MARKETING LTDA", "PESSOA JURIDICA",
             cnae="7311-4/00"),
]

PAY_HEADER = (
    "AA_ELEICAO;SG_UF;SQ_PRESTADOR_CONTAS;DS_TIPO_DOCUMENTO;NR_DOCUMENTO;"
    "DS_FONTE_DESPESA;DS_ORIGEM_DESPESA;DS_NATUREZA_DESPESA;DS_ESPECIE_RECURSO;"
    "SQ_DESPESA;SQ_PARCELAMENTO_DESPESA;DT_PAGTO_DESPESA;DS_DESPESA;VR_PAGTO_DESPESA"
)


def _pagamento(sq_despesa, sq_parcela, valor, data="20/09/2022"):
    return (
        f"2022;SP;9911;NOTA FISCAL;NFXYZ;OUTROS RECURSOS;Divulgacao de campanha;"
        f"FINANCEIRO;PIX;{sq_despesa};{sq_parcela};{data};IMPULSIONAMENTO;{valor}"
    )


PAY_LINES = [
    _pagamento("101", "9001", "500,00"),
    _pagamento("101", "9002", "300,00"),
    _pagamento("102", "9003", "300,00"),
    _pagamento("101", "9001", "500,00"),
]


def _zip() -> bytes:
    don_csv = (DON_HEADER + "\n" + "\n".join(DON_LINES) + "\n").encode("latin-1")
    exp_csv = (EXP_HEADER + "\n" + "\n".join(EXP_LINES) + "\n").encode("latin-1")
    pay_csv = (PAY_HEADER + "\n" + "\n".join(PAY_LINES) + "\n").encode("latin-1")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("receitas_candidatos_2022_BRASIL.csv", don_csv)
        zf.writestr("despesas_contratadas_candidatos_2022_BRASIL.csv", exp_csv)
        zf.writestr("despesas_pagas_candidatos_2022_BRASIL.csv", pay_csv)
    return buf.getvalue()


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "t.db"
    create_schema(path)

    def fake_download(url, dest):
        Path(dest).write_bytes(_zip())
        return 200, "application/zip"

    monkeypatch.setattr(accounts, "download", fake_download)
    return path


def _seed_other_candidate(con) -> int:
    t = "2026-01-01T00:00:00Z"
    con.execute("INSERT INTO people (cpf, cpf_trusted, voter_id, canonical_name, created_at) "
                "VALUES ('10000000000', 1, '900000000002', 'OUTRO CANDIDATO', ?)", (t,))
    pid = con.execute("SELECT id FROM people WHERE cpf = '10000000000'").fetchone()["id"]
    con.execute("INSERT INTO source (name, agency, type, base_url, created_at) "
                "VALUES ('seed', 'x', 'x', 'x', ?)", (t,))
    con.execute("INSERT INTO collection (source_id, url, accessed_at, payload_sha256, size_bytes) "
                "VALUES (1, 'x', ?, 'x', 0)", (t,))
    con.execute("INSERT INTO parse (collection_id, parser_name, parser_version, run_at) "
                "VALUES (1, 'seed', '0', ?)", (t,))
    con.execute(
        "INSERT INTO politician_history (person_id, cpf_trusted, tse_candidacy_id, year, "
        "provenance_id, collected_at) VALUES (?, 1, ?, 2022, 1, ?)",
        (pid, _OTHER_CANDIDATE_SQ, t))
    con.commit()
    return pid


def test_campaign_org_and_donations_created_and_deduped(db, tmp_path):
    con = connect(db, write=True)
    _seed_other_candidate(con)
    rep = accounts.run(con, years=[2022], tmp_dir=tmp_path)

    assert rep["orgs"] == 1
    assert rep["donations"] == 3
    assert rep["donations_linked_to_org"] == 3
    assert rep["total_donations_cents"] == 175050

    org = con.execute("SELECT id FROM campaign_org").fetchone()
    dons = con.execute(
        "SELECT * FROM campaign_donation ORDER BY tse_receipt_id"
    ).fetchall()
    assert all(d["campaign_org_id"] == org["id"] for d in dons)

    citizen, company, candidate = dons
    assert citizen["donor_cpf_cnpj"] == _DONOR_CPF
    assert citizen["donor_person_id"] is None
    assert citizen["donor_company_id"] is None
    assert citizen["amount_cents"] == 100000

    assert company["donor_cpf_cnpj"] == _DONOR_CNPJ
    assert company["donor_company_id"] is not None
    assert company["donor_cnae"] == "6201-5/01"
    donor_company = con.execute(
        "SELECT cnpj, kind FROM companies WHERE id = ?", (company["donor_company_id"],)
    ).fetchone()
    assert donor_company["cnpj"] == _DONOR_CNPJ and donor_company["kind"] == "donor"

    assert candidate["donor_tse_candidacy_id"] == _OTHER_CANDIDATE_SQ
    assert candidate["donor_person_id"] is not None

    src = con.execute(
        "SELECT s.name FROM campaign_donation d JOIN parse p ON p.id = d.provenance_id "
        "JOIN collection c ON c.id = p.collection_id JOIN source s ON s.id = c.source_id LIMIT 1"
    ).fetchone()
    assert src["name"] == "TSE - prestacao_contas"
    con.close()


def test_campaign_expenses_created_and_deduped(db, tmp_path):
    con = connect(db, write=True)
    _seed_other_candidate(con)
    rep = accounts.run(con, years=[2022], tmp_dir=tmp_path)

    assert rep["expenses"] == 3
    assert rep["expenses_linked_to_org"] == 3
    assert rep["total_expenses_cents"] == 125000

    org = con.execute("SELECT id FROM campaign_org").fetchone()
    exps = con.execute(
        "SELECT * FROM campaign_expense ORDER BY tse_expense_id"
    ).fetchall()
    assert all(e["campaign_org_id"] == org["id"] for e in exps)

    company, citizen, candidate = exps
    assert company["supplier_cpf_cnpj"] == _SUPPLIER_CNPJ
    assert company["supplier_company_id"] is not None
    assert company["supplier_cnae"] == "7311-4/00"
    supplier_company = con.execute(
        "SELECT cnpj, kind FROM companies WHERE id = ?", (company["supplier_company_id"],)
    ).fetchone()
    assert supplier_company["cnpj"] == _SUPPLIER_CNPJ and supplier_company["kind"] == "supplier"

    assert citizen["supplier_cpf_cnpj"] == _SUPPLIER_CPF
    assert citizen["supplier_person_id"] is None
    assert citizen["supplier_company_id"] is None

    assert candidate["supplier_tse_candidacy_id"] == _OTHER_CANDIDATE_SQ
    assert candidate["supplier_person_id"] is not None

    src = con.execute(
        "SELECT s.name FROM campaign_expense e JOIN parse p ON p.id = e.provenance_id "
        "JOIN collection c ON c.id = p.collection_id JOIN source s ON s.id = c.source_id LIMIT 1"
    ).fetchone()
    assert src["name"] == "TSE - prestacao_contas"
    con.close()


def test_expense_payments_created_deduped_and_linked(db, tmp_path):
    con = connect(db, write=True)
    rep = accounts.run(con, years=[2022], tmp_dir=tmp_path)

    assert rep["payments"] == 3
    assert rep["payments_linked_to_expense"] == 3
    assert rep["total_payments_cents"] == 110000

    expense_101 = con.execute(
        "SELECT id FROM campaign_expense WHERE tse_expense_id = '101'"
    ).fetchone()
    pays_101 = con.execute(
        "SELECT tse_installment_id, amount_cents, campaign_expense_id FROM campaign_expense_payment "
        "WHERE tse_expense_id = '101' ORDER BY tse_installment_id"
    ).fetchall()
    assert [dict(r) for r in pays_101] == [
        {"tse_installment_id": "9001", "amount_cents": 50000, "campaign_expense_id": expense_101["id"]},
        {"tse_installment_id": "9002", "amount_cents": 30000, "campaign_expense_id": expense_101["id"]},
    ]

    src = con.execute(
        "SELECT s.name FROM campaign_expense_payment p JOIN parse pa ON pa.id = p.provenance_id "
        "JOIN collection c ON c.id = pa.collection_id JOIN source s ON s.id = c.source_id LIMIT 1"
    ).fetchone()
    assert src["name"] == "TSE - prestacao_contas"
    con.close()


def test_never_creates_a_people_row_for_a_plain_donor_or_supplier(db, tmp_path):
    con = connect(db, write=True)
    before = con.execute("SELECT count(*) FROM people").fetchone()[0]
    accounts.run(con, years=[2022], tmp_dir=tmp_path)
    after = con.execute("SELECT count(*) FROM people").fetchone()[0]
    assert after == before + 1
    con.close()


def test_rerun_is_idempotent(db, tmp_path):
    con = connect(db, write=True)
    accounts.run(con, years=[2022], tmp_dir=tmp_path)
    rep2 = accounts.run(con, years=[2022], tmp_dir=tmp_path)
    assert rep2["orgs"] == 1
    assert rep2["donations"] == 3
    assert rep2["expenses"] == 3
    assert rep2["payments"] == 3
    assert con.execute("SELECT count(*) FROM campaign_org").fetchone()[0] == 1
    assert con.execute("SELECT count(*) FROM campaign_donation").fetchone()[0] == 3
    assert con.execute("SELECT count(*) FROM campaign_expense").fetchone()[0] == 3
    assert con.execute("SELECT count(*) FROM campaign_expense_payment").fetchone()[0] == 3
    assert con.execute("SELECT count(*) FROM companies").fetchone()[0] == 3
    con.close()
