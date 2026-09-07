"""SQLite connection + schema application (see ADs/banco.md)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_SQL = Path(__file__).with_name("schema.sql")


def connect(path: str | Path, *, write: bool = False) -> sqlite3.Connection:
    """Open the database. Read-only by default (query_only); write is for ETL only."""
    con = sqlite3.connect(str(path))
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA synchronous = NORMAL")
    if not write:
        con.execute("PRAGMA query_only = ON")
    return con


def create_schema(path: str | Path) -> None:
    """Create the database and apply schema.sql (idempotent: everything is IF NOT EXISTS)."""
    con = sqlite3.connect(str(path))
    try:
        con.executescript(SCHEMA_SQL.read_text(encoding="utf-8"))
        _migrate(con)
        con.commit()
    finally:
        con.close()


# Columns added to a table that already existed before this column was
# introduced -- `CREATE TABLE IF NOT EXISTS` in schema.sql only shapes a
# BRAND NEW table, so an existing rewrite-only .db needs these applied by
# hand once. Safe to call every time: each ALTER only runs if the column is
# still missing.
_ADDED_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "signal": [("amount_cents", "INTEGER"), ("path_length", "INTEGER")],
}


def _migrate(con: sqlite3.Connection) -> None:
    for table, columns in _ADDED_COLUMNS.items():
        existing = {row[1] for row in con.execute(f"PRAGMA table_info({table})")}  # noqa: S608
        for name, decl in columns:
            if name not in existing:
                con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")  # noqa: S608
