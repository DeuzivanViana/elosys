"""Identity resolution (see ADs/identidade.md)."""

from __future__ import annotations

import sqlite3

from .util import cpf_is_valid, digits_only, now_utc


def resolve_person(con: sqlite3.Connection, *, cpf: str | None,
                   voter_id: str | None, normalized_name: str | None) -> tuple[int, bool]:
    cpf_d = digits_only(cpf)
    voter_d = digits_only(voter_id)
    cpf_ok = cpf_is_valid(cpf_d)

    person_id: int | None = None
    if voter_d:
        hit = con.execute(
            "SELECT id FROM people WHERE voter_id = ? ORDER BY id LIMIT 1", (voter_d,)
        ).fetchone()
        person_id = hit["id"] if hit else None
    if person_id is None and cpf_ok:
        hit = con.execute(
            "SELECT id FROM people WHERE cpf = ? ORDER BY id LIMIT 1", (cpf_d,)
        ).fetchone()
        person_id = hit["id"] if hit else None
    if person_id is None:
        cur = con.execute(
            "INSERT INTO people (cpf, cpf_trusted, voter_id, canonical_name, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (cpf_d if cpf_ok else None, 1 if cpf_ok else 0, voter_d, normalized_name, now_utc()),
        )
        return int(cur.lastrowid), cpf_ok

    if cpf_ok:
        con.execute(
            "UPDATE people SET cpf = ?, cpf_trusted = 1 WHERE id = ? AND cpf IS NULL",
            (cpf_d, person_id),
        )
    if voter_d:
        con.execute(
            "UPDATE people SET voter_id = ? WHERE id = ? AND voter_id IS NULL",
            (voter_d, person_id),
        )
    return person_id, cpf_ok
