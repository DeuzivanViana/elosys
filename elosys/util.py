"""Small stateless helpers."""

from __future__ import annotations

import json
import subprocess
import unicodedata
from datetime import UTC, datetime
from functools import cache

_TSE_NULLS = {"", "#NULO#", "#NE#", "#NE", "#NULO", "N/A", "NULO"}


def _is_tse_null(v: str) -> bool:
    u = v.upper()
    return u in _TSE_NULLS or (v.startswith("-") and v[1:].isdigit())


def now_utc() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@cache
def git_commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True, timeout=5,
        )
        return out.stdout.strip() or None
    except (subprocess.SubprocessError, OSError):
        return None


def clean_tse(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    return None if _is_tse_null(v) else v


def normalize_name(name: str | None) -> str | None:
    name = clean_tse(name)
    if not name:
        return None
    no_accents = "".join(
        c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c)
    )
    return " ".join(no_accents.upper().split())


def digits_only(value: str | None) -> str | None:
    value = clean_tse(value)
    if not value:
        return None
    d = "".join(c for c in value if c.isdigit())
    return d or None


def cpf_is_valid(cpf: str | None) -> bool:
    if not cpf or len(cpf) != 11 or len(set(cpf)) == 1:
        return False
    for cut in (9, 10):
        total = sum(int(cpf[i]) * (cut + 1 - i) for i in range(cut))
        check = (total * 10) % 11 % 10
        if check != int(cpf[cut]):
            return False
    return True


def iso_date(ddmmyyyy: str | None) -> str | None:
    v = clean_tse(ddmmyyyy)
    if not v:
        return None
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m-%d")  # noqa: DTZ007
        except ValueError:
            continue
    return v


def brl_to_cents(value: str | None) -> int | None:
    v = clean_tse(value)
    if not v:
        return None
    v = v.replace(" ", "")
    if "," in v:
        v = v.replace(".", "").replace(",", ".")
    try:
        return round(float(v) * 100)
    except ValueError:
        return None


def canonical_json(obj: object) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
