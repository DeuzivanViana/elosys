"""TSE prestação de contas crawler (campaign_org) against a synthetic zip."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from elosys.db import connect, create_schema
from elosys.tse import accounts

_CPF = "11144477735"   # valid check digits
_CNPJ = "40430149000110"
_SQ = "250000900001"

HEADER = (
    "AA_ELEICAO;NM_TIPO_ELEICAO;ST_TURNO;SQ_PRESTADOR_CONTAS;SG_UF;NM_UE;"
    "NR_CNPJ_PRESTADOR_CONTA;DS_CARGO;SQ_CANDIDATO;NR_CANDIDATO;NM_CANDIDATO;"
    "NR_CPF_CANDIDATO;NR_PARTIDO;SG_PARTIDO;NM_PARTIDO;DS_FONTE_RECEITA;"
    "NR_CPF_CNPJ_DOADOR;NM_DOADOR;DT_RECEITA;VR_RECEITA"
)


def _receita(valor, doador="12345678909", nome_doador="FULANO"):
    return (
        f"2022;ORDINÁRIA;1;9911;SP;BRASIL;{_CNPJ};DEPUTADO FEDERAL;{_SQ};1234;"
        f"JOAO DA SILVA;{_CPF};13;PT;PARTIDO;OUTROS RECURSOS;{doador};{nome_doador};"
        f"13/09/2022;{valor}"
    )


LINES = [_receita("1000,00"), _receita("250,50", "98765432000155", "EMPRESA X"),
         _receita("1000,00")]  # 3 donation rows, same campaign -> one campaign_org


def _zip(lines=LINES) -> bytes:
    csv_txt = (HEADER + "\n" + "\n".join(lines) + "\n").encode("latin-1")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("receitas_candidatos_2022_BRASIL.csv", csv_txt)
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


def test_campaign_org_created_and_deduped(db, tmp_path):
    con = connect(db, write=True)
    rep = accounts.run(con, years=[2022], tmp_dir=tmp_path)
    assert rep["orgs"] == 1
    assert rep["companies"] == 1

    org = con.execute("SELECT * FROM campaign_org").fetchone()
    assert org["cnpj"] == _CNPJ
    assert org["tse_candidacy_id"] == _SQ
    assert org["candidate_cpf"] == _CPF
    assert org["person_id"] is not None

    company = con.execute("SELECT cnpj, kind FROM companies").fetchone()
    assert company["cnpj"] == _CNPJ and company["kind"] == "campaign"

    # provenance: campaign_org -> parse -> collection -> source
    src = con.execute(
        "SELECT s.name FROM campaign_org o JOIN parse p ON p.id = o.provenance_id "
        "JOIN collection c ON c.id = p.collection_id JOIN source s ON s.id = c.source_id"
    ).fetchone()
    assert src["name"] == "TSE - prestacao_contas"
    con.close()


def test_links_to_existing_politician(db, tmp_path):
    con = connect(db, write=True)
    t = "2026-01-01T00:00:00Z"
    con.execute("INSERT INTO people (cpf, cpf_trusted, voter_id, canonical_name, created_at) "
                "VALUES (?, 1, '900000000001', 'JOAO DA SILVA', ?)", (_CPF, t))
    pid = con.execute("SELECT id FROM people").fetchone()["id"]
    con.execute("INSERT INTO source (name, agency, type, base_url, created_at) "
                "VALUES ('seed', 'x', 'x', 'x', ?)", (t,))
    con.execute("INSERT INTO collection (source_id, url, accessed_at, payload_sha256, size_bytes) "
                "VALUES (1, 'x', ?, 'x', 0)", (t,))
    con.execute("INSERT INTO parse (collection_id, parser_name, parser_version, run_at) "
                "VALUES (1, 'seed', '0', ?)", (t,))
    con.execute(
        "INSERT INTO politician_history (person_id, cpf_trusted, tse_candidacy_id, year, "
        "provenance_id, collected_at) VALUES (?, 1, ?, 2022, 1, ?)", (pid, _SQ, t))
    con.commit()

    accounts.run(con, years=[2022], tmp_dir=tmp_path)
    org = con.execute("SELECT person_id FROM campaign_org").fetchone()
    assert org["person_id"] == pid
    con.close()


def test_rerun_is_idempotent(db, tmp_path):
    con = connect(db, write=True)
    accounts.run(con, years=[2022], tmp_dir=tmp_path)
    rep2 = accounts.run(con, years=[2022], tmp_dir=tmp_path)
    assert rep2["orgs"] == 1
    assert con.execute("SELECT count(*) FROM campaign_org").fetchone()[0] == 1
    assert con.execute("SELECT count(*) FROM companies").fetchone()[0] == 1
    con.close()
