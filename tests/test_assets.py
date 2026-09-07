"""TSE bem_candidato crawler (declared_assets) against a synthetic zip."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from elosys.db import connect, create_schema
from elosys.tse import assets

_SQ = "250001606095"

HEADER = (
    "ANO_ELEICAO;SG_UF;SQ_CANDIDATO;NR_ORDEM_BEM_CANDIDATO;CD_TIPO_BEM_CANDIDATO;"
    "DS_TIPO_BEM_CANDIDATO;DS_BEM_CANDIDATO;VR_BEM_CANDIDATO;DT_ULT_ATUAL_BEM_CANDIDATO"
)


def _bem(sq, ordem, tipo, desc, valor):
    return f"2022;SP;{sq};{ordem};11;{tipo};{desc};{valor};07/07/2022"


LINES = [
    _bem(_SQ, "1", "Apartamento", "Apartamento na cidade de Sao Paulo", "750000,00"),
    _bem(_SQ, "2", "Veiculo automotor", "Carro popular", "35000,00"),
    _bem("999999999999", "1", "Dinheiro em especie", "Reserva", "1000,00"),  # unlinked candidacy
]


def _zip(lines=LINES) -> bytes:
    csv_txt = (HEADER + "\n" + "\n".join(lines) + "\n").encode("latin-1")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("bem_candidato_2022_BRASIL.csv", csv_txt)
    return buf.getvalue()


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "t.db"
    create_schema(path)

    def fake_download(url, dest):
        Path(dest).write_bytes(_zip())
        return 200, "application/zip"

    monkeypatch.setattr(assets, "download", fake_download)
    return path


def _seed_candidacy(con) -> tuple[int, int]:
    t = "2026-01-01T00:00:00Z"
    con.execute("INSERT INTO people (cpf, cpf_trusted, canonical_name, created_at) "
                "VALUES ('11144477735', 1, 'JOAO DA SILVA', ?)", (t,))
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
    hid = con.execute("SELECT id FROM politician_history").fetchone()["id"]
    con.commit()
    return pid, hid


def test_assets_created_and_linked(db, tmp_path):
    con = connect(db, write=True)
    pid, hid = _seed_candidacy(con)
    rep = assets.run(con, years=[2022], tmp_dir=tmp_path)

    assert rep["assets"] == 3
    assert rep["candidacies"] == 2
    assert rep["linked_to_person"] == 2
    assert rep["total_value_cents"] == 78600000  # 750000+35000+1000 = 786000,00

    linked = con.execute(
        "SELECT asset_type, value_cents, person_id, history_id FROM declared_assets "
        "WHERE tse_candidacy_id = ? ORDER BY asset_order", (_SQ,)
    ).fetchall()
    assert linked[0]["asset_type"] == "Apartamento"
    assert linked[0]["value_cents"] == 75000000
    assert linked[0]["person_id"] == pid
    assert linked[0]["history_id"] == hid

    unlinked = con.execute(
        "SELECT person_id FROM declared_assets WHERE tse_candidacy_id = '999999999999'"
    ).fetchone()
    assert unlinked["person_id"] is None

    src = con.execute(
        "SELECT s.name FROM declared_assets d JOIN parse p ON p.id = d.provenance_id "
        "JOIN collection c ON c.id = p.collection_id JOIN source s ON s.id = c.source_id LIMIT 1"
    ).fetchone()
    assert src["name"] == "TSE - bem_candidato"
    con.close()


def test_rerun_is_idempotent(db, tmp_path):
    con = connect(db, write=True)
    _seed_candidacy(con)
    assets.run(con, years=[2022], tmp_dir=tmp_path)
    rep2 = assets.run(con, years=[2022], tmp_dir=tmp_path)
    assert rep2["assets"] == 3
    assert con.execute("SELECT count(*) FROM declared_assets").fetchone()[0] == 3
    con.close()
