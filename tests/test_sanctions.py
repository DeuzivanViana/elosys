"""Portal da Transparência CEIS/CNEP crawler against synthetic zips (no network)."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from elosys.db import connect, create_schema
from elosys.transparencia import sanctions

_CPF_KNOWN = "11144477735"
_CPF_UNKNOWN = "45612378900"
_CNPJ = "98765432000155"

CEIS_HEADER = (
    "CADASTRO;CODIGO DA SANCAO;TIPO DE PESSOA;CPF OU CNPJ DO SANCIONADO;NOME DO SANCIONADO;"
    "NOME INFORMADO PELO ORGAO SANCIONADOR;RAZAO SOCIAL - CADASTRO RECEITA;"
    "NOME FANTASIA - CADASTRO RECEITA;NUMERO DO PROCESSO;CATEGORIA DA SANCAO;"
    "DATA INICIO SANCAO;DATA FINAL SANCAO;DATA PUBLICACAO;PUBLICACAO;"
    "DETALHAMENTO DO MEIO DE PUBLICACAO;DATA DO TRANSITO EM JULGADO;ABRANGENCIA DA SANCAO;"
    "ORGAO SANCIONADOR;UF ORGAO SANCIONADOR;ESFERA ORGAO SANCIONADOR;FUNDAMENTACAO LEGAL;"
    "DATA ORIGEM INFORMACAO;ORIGEM INFORMACOES;OBSERVACOES"
)
CNEP_HEADER = (
    "CADASTRO;CODIGO DA SANCAO;TIPO DE PESSOA;CPF OU CNPJ DO SANCIONADO;NOME DO SANCIONADO;"
    "NOME INFORMADO PELO ORGAO SANCIONADOR;RAZAO SOCIAL - CADASTRO RECEITA;"
    "NOME FANTASIA - CADASTRO RECEITA;NUMERO DO PROCESSO;CATEGORIA DA SANCAO;VALOR DA MULTA;"
    "DATA INICIO SANCAO;DATA FINAL SANCAO;DATA PUBLICACAO;PUBLICACAO;"
    "DETALHAMENTO DO MEIO DE PUBLICACAO;DATA DO TRANSITO EM JULGADO;ABRANGENCIA DA SANCAO;"
    "ORGAO SANCIONADOR;UF ORGAO SANCIONADOR;ESFERA ORGAO SANCIONADOR;FUNDAMENTACAO LEGAL;"
    "DATA ORIGEM INFORMACAO;ORIGEM INFORMACOES;OBSERVACOES"
)


def _ceis_row(code, cpf_cnpj, nome, tipo="F"):
    return (
        f'"CEIS";"{code}";"{tipo}";"{cpf_cnpj}";"{nome}";"{nome}";"";"";"PROC{code}";'
        f'"Impedimento";"01/01/2020";"01/01/2030";"";"Sem Informacao";"";"01/01/2020";'
        f'"No orgao sancionador";"ORGAO X";"SP";"ESTADUAL";"LEI 8429";"01/01/2020";"CNJ";""'
    )


def _cnep_row(code, cnpj, nome, valor):
    return (
        f'"CNEP";"{code}";"J";"{cnpj}";"{nome}";"{nome}";"{nome} LTDA";"{nome}";"PROC{code}";'
        f'"Multa";"{valor}";"01/01/2020";"";"01/01/2020";"DOU";"DOU - Aviso";"";'
        f'"No orgao sancionador";"PETROBRAS";"";"FEDERAL";"LEI 12846";"01/01/2020";"CGU";""'
    )


CEIS_LINES = [
    _ceis_row("1", _CPF_KNOWN, "JOAO DA SILVA"),
    _ceis_row("2", _CPF_UNKNOWN, "FULANO SANCIONADO"),
    _ceis_row("1", _CPF_KNOWN, "JOAO DA SILVA"),
]
CNEP_LINES = [
    _cnep_row("100", _CNPJ, "EMPRESA PUNIDA", "2219084,85"),
]


def _zip(header, lines) -> bytes:
    csv_txt = (header + "\r\n" + "\r\n".join(lines) + "\r\n").encode("latin-1")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("20260904_X.csv", csv_txt)
    return buf.getvalue()


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "t.db"
    create_schema(path)
    t = "2026-01-01T00:00:00Z"
    con = connect(path, write=True)
    con.execute("INSERT INTO people (cpf, cpf_trusted, canonical_name, created_at) "
                "VALUES (?, 1, 'JOAO DA SILVA', ?)", (_CPF_KNOWN, t))
    con.commit()
    con.close()

    def fake_discover_date(registry_path):
        return "20260904"

    def fake_download(url, dest):
        if "/ceis/" in url:
            Path(dest).write_bytes(_zip(CEIS_HEADER, CEIS_LINES))
        else:
            Path(dest).write_bytes(_zip(CNEP_HEADER, CNEP_LINES))
        return 200, "application/zip"

    monkeypatch.setattr(sanctions, "_discover_date", fake_discover_date)
    monkeypatch.setattr(sanctions, "download", fake_download)
    return path


def test_ingests_both_registries_and_dedupes(db, tmp_path):
    con = connect(db, write=True)
    rep = sanctions.run(con, tmp_dir=tmp_path)

    assert rep["sanctions"] == 3
    assert rep["registries"]["ceis"]["new_sanctions"] == 2
    assert rep["registries"]["cnep"]["new_sanctions"] == 1
    con.close()


def test_known_politician_linked_unknown_citizen_not(db, tmp_path):
    con = connect(db, write=True)
    sanctions.run(con, tmp_dir=tmp_path)

    known = con.execute(
        "SELECT person_id FROM sanction WHERE cpf_cnpj = ?", (_CPF_KNOWN,)
    ).fetchone()
    assert known["person_id"] is not None

    unknown = con.execute(
        "SELECT person_id FROM sanction WHERE cpf_cnpj = ?", (_CPF_UNKNOWN,)
    ).fetchone()
    assert unknown["person_id"] is None
    con.close()


def test_never_creates_a_people_row_for_a_sanctioned_citizen(db, tmp_path):
    con = connect(db, write=True)
    before = con.execute("SELECT count(*) FROM people").fetchone()[0]
    sanctions.run(con, tmp_dir=tmp_path)
    after = con.execute("SELECT count(*) FROM people").fetchone()[0]
    assert after == before
    con.close()


def test_cnep_fine_amount_and_company_linked(db, tmp_path):
    con = connect(db, write=True)
    sanctions.run(con, tmp_dir=tmp_path)

    row = con.execute(
        "SELECT registry, fine_amount_cents, company_id FROM sanction WHERE cpf_cnpj = ?",
        (_CNPJ,),
    ).fetchone()
    assert row["registry"] == "CNEP"
    assert row["fine_amount_cents"] == 221908485
    assert row["company_id"] is not None

    company = con.execute(
        "SELECT cnpj, kind FROM companies WHERE id = ?", (row["company_id"],)
    ).fetchone()
    assert company["cnpj"] == _CNPJ and company["kind"] == "sanctioned"
    con.close()


def test_rerun_is_idempotent(db, tmp_path):
    con = connect(db, write=True)
    sanctions.run(con, tmp_dir=tmp_path)
    rep2 = sanctions.run(con, tmp_dir=tmp_path)
    assert rep2["sanctions"] == 3
    assert con.execute("SELECT count(*) FROM sanction").fetchone()[0] == 3
    con.close()
