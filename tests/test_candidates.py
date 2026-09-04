"""Candidate ingestion pipeline against a synthetic zip (no network)."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from elosys import provenance
from elosys.db import connect, create_schema
from elosys.tse import candidates

HEADER = (
    "ANO_ELEICAO;NM_TIPO_ELEICAO;NR_TURNO;SG_UF;SG_UE;NM_UE;DS_CARGO;SQ_CANDIDATO;"
    "NR_CANDIDATO;NM_CANDIDATO;NM_URNA_CANDIDATO;NR_CPF_CANDIDATO;"
    "NR_TITULO_ELEITORAL_CANDIDATO;DS_SITUACAO_CANDIDATURA;DS_DETALHE_SITUACAO_CAND;"
    "DS_SIT_TOT_TURNO;NR_PARTIDO;SG_PARTIDO;NM_PARTIDO;DT_NASCIMENTO;DS_GENERO;"
    "DS_GRAU_INSTRUCAO;DS_ESTADO_CIVIL;DS_COR_RACA;DS_OCUPACAO"
)
_CPF_A = "11144477735"   # valid check digits
_CPF_B = "15350946056"   # valid check digits


def _row(sq, name, cpf, voter, office="DEPUTADO FEDERAL", uf="SP"):
    return (
        f"2022;ELEICAO ORDINARIA;1;{uf};{uf};CIDADE;{office};{sq};1234;{name};{name};"
        f"{cpf};{voter};APTO;DEFERIDO;ELEITO;13;PT;PARTIDO;10/05/1980;MASCULINO;"
        f"SUPERIOR COMPLETO;CASADO(A);BRANCA;ADVOGADO"
    )


LINES = [
    _row("2500001", "JOAO DA SILVA", _CPF_A, "100000000001"),
    _row("2500002", "MARIA SOUZA", "-4", "200000000002"),          # masked cpf -> voter_id fallback
    # same CPF on two different voter_ids -> ambiguous, must be dropped from both
    _row("2500003", "PEDRO ALVES", _CPF_B, "300000000003"),
    _row("2500004", "OUTRO PEDRO", _CPF_B, "400000000004"),
]


def _synthetic_zip(lines=LINES) -> bytes:
    csv_txt = (HEADER + "\n" + "\n".join(lines) + "\n").encode("latin-1")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("consulta_cand_2022_BRASIL.csv", csv_txt)
    return buf.getvalue()


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "t.db"
    create_schema(path)

    def fake_download(url, dest):
        Path(dest).write_bytes(_synthetic_zip())
        return 200, "application/zip"

    monkeypatch.setattr(candidates, "download", fake_download)
    return path


def _run(con, tmp_path):
    candidates.ingest_year(con, 2022, tmp_path)
    return candidates.promote(con)


def test_full_ingestion(db, tmp_path):
    con = connect(db, write=True)
    p = _run(con, tmp_path)
    assert p["promoted"] == 4

    rows = {r["full_name"]: r for r in con.execute(
        "SELECT full_name, cpf, cpf_trusted, result, person_id FROM politician_history"
    )}
    assert rows["JOAO DA SILVA"]["cpf"] == _CPF_A and rows["JOAO DA SILVA"]["cpf_trusted"] == 1
    assert rows["MARIA SOUZA"]["cpf"] is None and rows["MARIA SOUZA"]["cpf_trusted"] == 0

    # provenance: every row -> parse -> collection -> source
    src = con.execute(
        "SELECT s.name FROM politician_history h "
        "JOIN parse p ON p.id = h.provenance_id "
        "JOIN collection c ON c.id = p.collection_id "
        "JOIN source s ON s.id = c.source_id LIMIT 1"
    ).fetchone()
    assert src["name"] == "TSE - consulta_cand"

    # manifest lists the collection with its file hash
    man = provenance.manifest(con)
    assert man["sources"][0]["files"][0]["filename"] == "consulta_cand_2022_BRASIL.csv"
    con.close()


def test_ambiguous_cpf_dropped(db, tmp_path):
    con = connect(db, write=True)
    p = _run(con, tmp_path)
    assert p["rejected_cpf"] == 1
    assert p["rows_with_cpf_dropped"] == 2

    rej = con.execute("SELECT cpf, reason, distinct_voter_ids FROM rejected_cpf").fetchone()
    assert rej["cpf"] == _CPF_B and rej["reason"] == "multiple_voter_ids"
    assert rej["distinct_voter_ids"] == 2

    # both PEDRO rows keep cpf NULL and stay distinct people (matched by voter_id)
    pedros = con.execute(
        "SELECT full_name, cpf, cpf_trusted, person_id FROM politician_history "
        "WHERE full_name LIKE '%PEDRO%' ORDER BY full_name"
    ).fetchall()
    assert all(r["cpf"] is None and r["cpf_trusted"] == 0 for r in pedros)
    assert pedros[0]["person_id"] != pedros[1]["person_id"]
    con.close()


def test_recollection_dedup(db, tmp_path):
    con = connect(db, write=True)
    _run(con, tmp_path)
    p2 = _run(con, tmp_path)  # same file -> collection dedup -> nothing staged -> nothing promoted
    assert p2["promoted"] == 0
    assert con.execute("SELECT count(*) FROM politician_history").fetchone()[0] == 4
    con.close()


def test_staging_table_is_gone_after_build(db, tmp_path):
    con = connect(db, write=True)
    _run(con, tmp_path)
    got = con.execute(
        "SELECT name FROM sqlite_temp_master WHERE type='table' AND name='stg_candidate'"
    ).fetchone()
    assert got is None
    con.close()


def test_legacy_year_not_implemented(db, tmp_path):
    con = connect(db, write=True)
    with pytest.raises(NotImplementedError):
        candidates.ingest_year(con, 2014, tmp_path)
    con.close()
