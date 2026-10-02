"""social_review: the DeepSeek call is mocked; we check post selection,"""

from __future__ import annotations

import json

from elosys.db import connect, create_schema
from elosys.rules import social_review

T = "2026-01-01T00:00:00Z"


def _seed(con):
    con.execute("INSERT INTO source (name, agency, type, base_url, created_at) "
                "VALUES ('X','x','scraping','x',?)", (T,))
    con.execute("INSERT INTO social_account (network, handle, source_id, status, first_seen_at) "
                "VALUES ('x','fulano',1,'active',?)", (T,))
    acc = con.execute("SELECT id FROM social_account").fetchone()["id"]
    rows = [
        ("111", "post", "dinheiro desviado dos cofres públicos", '["desviado"]'),
        ("222", "post", "hoje é dia de sol e futebol", "[]"),
        ("333", "reply", "voce e um verme e deveria sumir", '["verme"]'),
    ]
    for ext, kind, text, matched in rows:
        con.execute(
            "INSERT INTO social_post (social_account_id, external_id, kind, text, matched_terms, "
            "matched_query, raw_json, raw_sha256, retrieved_at) "
            "VALUES (?,?,?,?,?,'q','{}','" + "0" * 64 + "',?)",
            (acc, ext, kind, text, matched, T),
        )
    con.commit()


def _fake_chat(offensive, cats, sev):
    def _inner(system_prompt, user_prompt, *, model="deepseek-chat", temperature=0.2, timeout=120):
        assert "julgando só as palavras do autor" in user_prompt
        return {
            "data": {
                "ofensivo": offensive,
                "categorias": cats,
                "severity": sev,
                "trecho": "verme" if offensive else "",
                "explicacao": "teste",
            },
            "raw": "{}",
            "prompt_tokens": 100,
            "completion_tokens": 20,
        }
    return _inner


def test_only_matched_skips_clean_post(tmp_path, monkeypatch):
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _seed(con)
    monkeypatch.setattr(social_review, "chat_json", _fake_chat(True, ["desumanizacao"], "high"))
    rep = social_review.run(con, limit=50)
    assert rep["reviewed"] == 2
    ids = {r["external_id"] for r in con.execute(
        "SELECT p.external_id FROM social_post_review r JOIN social_post p ON p.id = r.social_post_id"
    )}
    assert ids == {"111", "333"}


def test_writes_review_row_and_is_incremental(tmp_path, monkeypatch):
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _seed(con)
    monkeypatch.setattr(social_review, "chat_json", _fake_chat(True, ["desumanizacao"], "high"))
    social_review.run(con, limit=50)

    row = con.execute(
        "SELECT * FROM social_post_review r JOIN social_post p ON p.id = r.social_post_id "
        "WHERE p.external_id = '333'"
    ).fetchone()
    assert row["is_offensive"] == 1
    assert row["severity"] == "high"
    assert json.loads(row["categories"]) == ["desumanizacao"]
    assert row["quote"] == "verme"

    rep2 = social_review.run(con, limit=50)
    assert rep2["reviewed"] == 0
    rep3 = social_review.run(con, limit=50, refresh=True)
    assert rep3["reviewed"] == 2


def test_non_offensive_clears_categories(tmp_path, monkeypatch):
    path = tmp_path / "t.db"
    create_schema(path)
    con = connect(path, write=True)
    _seed(con)
    monkeypatch.setattr(social_review, "chat_json", _fake_chat(False, ["desumanizacao"], "low"))
    social_review.run(con, limit=50)
    for row in con.execute("SELECT categories, quote, is_offensive FROM social_post_review"):
        assert row["is_offensive"] == 0
        assert json.loads(row["categories"]) == []
        assert row["quote"] is None
