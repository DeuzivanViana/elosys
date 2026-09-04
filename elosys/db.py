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
        con.commit()
    finally:
        con.close()
