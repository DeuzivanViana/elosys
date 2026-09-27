"""Enrichment: DivulgaCandContas fotoUrl lookup -> candidate_photo.

See the long comment in schema.sql above `candidate_photo` for why this
exists and why it's an explicit exception to "avoid the DivulgaCandContas
SPA API" (ADs/politician.md §5 originally flagged it as fragile). Short
version: TSE's open data portal only ships photos bundled in one zip per
(year, UF) with no per-candidate URL; DivulgaCandContas's own search API
does expose a direct `fotoUrl` per candidacy, so this crawler calls that --
one HTTP request per PERSON (by CPF, covering every year of theirs in a
single response), not per candidacy or per zip, and no file is ever
downloaded and kept -- the image stays on TSE's own CDN, only the URL
string is cached here.

Searched by CPF, not name: `pesquisar?cpf=...` returns exactly that
person's own candidacies -- no homonym risk, unlike a name search (which
this crawler used in an earlier version; ADs/identidade.md says never
match on name alone, so CPF search is the correct one to have used from
the start). Only people with a trustworthy CPF on file are queued.

Like receita/cnpj.py, this is NOT rewrite-only: it's a rate-limited lookup
API, so `run()` is an incremental cache that only looks up people missing a
row here, safe to re-run repeatedly to fill in more of the catalog.

CONCURRENCY: one request/person against an undocumented internal API means
covering everyone sequentially is a weeks-long endeavour. `--workers` runs
several HTTP requests in flight via a thread pool (this is I/O-bound --
the request itself is what's slow, not CPU) while all sqlite writes stay
on the main thread (sqlite3 connections aren't thread-safe to share).
Higher workers = faster, but this API has no published rate limit to
respect, and hammering it risks the Akamai bot filter blocking the IP
outright -- which would also break the OTHER TSE crawlers in this project
that hit the same CDN/WAF. Default is deliberately conservative; raise it
carefully and watch the error rate.
"""

from __future__ import annotations

import json
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from ..log import RowCounter, get_logger, step
from ..provenance import download, get_source, record_collection, record_parse
from ..util import now_utc

log = get_logger("elosys.tse.photo_urls")

PARSER_NAME = "tse.photo_urls"
PARSER_VERSION = "2.0"  # 2.0: search by cpf, not name (exact match, no homonym filtering needed)

URL_TEMPLATE = (
    "https://divulgacandcontas.tse.jus.br/divulga/rest/v1/candidatura/pesquisar"
    "?cpf={cpf}&page=0&size=20"
)
DEFAULT_LIMIT = 500
DEFAULT_DELAY_SECONDS = 0.4  # politeness delay between requests; not a published rate limit
DEFAULT_WORKERS = 1  # sequential by default -- see CONCURRENCY note above

SOURCE = dict(
    name="TSE - DivulgaCandContas fotoUrl",
    agency="Tribunal Superior Eleitoral",
    type="api",
    base_url="https://divulgacandcontas.tse.jus.br/divulga/rest/v1/candidatura/pesquisar",
    legal_basis=(
        "Foto oficial enviada no registro de candidatura, publicada como dado aberto por "
        "resolucoes do TSE; URL obtida via a API de busca (por CPF) do sistema "
        "DivulgaCandContas (voltado ao publico geral, nao documentado como API estavel)."
    ),
    notes="Interno/nao documentado -- ver comentario em schema.sql acima de candidate_photo.",
)


def run(con: sqlite3.Connection, *, limit: int = DEFAULT_LIMIT,
        person_ids: list[int] | None = None, years: list[int] | None = None,
        tmp_dir: str | Path = "dados_tmp", delay_seconds: float = DEFAULT_DELAY_SECONDS,
        workers: int = DEFAULT_WORKERS) -> dict:
    tmp_dir = Path(tmp_dir)
    source_id = get_source(con, **SOURCE)

    if person_ids:
        targets = [
            dict(r) for r in con.execute(
                f"SELECT id, cpf FROM people WHERE id IN ({', '.join('?' * len(person_ids))}) "
                f"AND cpf IS NOT NULL",
                person_ids,
            )
        ]
    elif years:
        # Scoped to whoever has a candidacy in one of these years -- e.g.
        # just the current election cycle, instead of the whole historical
        # catalog. A person appears once even if they also ran in an
        # unscoped year; one CPF search still returns every year of theirs.
        placeholders = ", ".join("?" * len(years))
        targets = [
            dict(r) for r in con.execute(
                f"""SELECT DISTINCT p.id, p.cpf FROM people p
                    JOIN politician_history ph ON ph.person_id = p.id AND ph.year IN ({placeholders})
                    WHERE p.cpf IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM candidate_photo cp WHERE cp.person_id = p.id)
                    LIMIT ?""",
                [*years, limit],
            )
        ]
    else:
        # Only people who actually ran (have a politician_history row) AND
        # have a CPF on file (masked in the 2024 file for some -- see
        # ADs/politician.md) are worth a lookup. Prioritise whoever's most
        # likely to actually be looked at: their own most recent candidacy
        # year, descending. Same "can only ever cover a slice, so rank it"
        # idea as receita/cnpj.py.
        targets = [
            dict(r) for r in con.execute(
                """SELECT p.id, p.cpf, max(ph.year) AS latest_year FROM people p
                   JOIN politician_history ph ON ph.person_id = p.id
                   WHERE p.cpf IS NOT NULL
                     AND NOT EXISTS (SELECT 1 FROM candidate_photo cp WHERE cp.person_id = p.id)
                   GROUP BY p.id
                   ORDER BY latest_year DESC, p.id LIMIT ?""",
                (limit,),
            )
        ]

    log.info("incremental cache: %s people to look up this run (limit=%s, years=%s, workers=%s)",
             f"{len(targets):,}", "none" if (person_ids or years) else limit, years, workers)

    fetched = not_found = errors = 0
    rc = RowCounter(log, "fotoUrl lookups", every=50)
    with step(log, f"divulgacand fotoUrl lookups ({len(targets)})"):
        if workers <= 1:
            for row in targets:
                rc.tick()
                fetch = _download_one(row["id"], row["cpf"], tmp_dir)
                outcome = _process_one(con, source_id, fetch)
                if outcome == "fetched":
                    fetched += 1
                elif outcome == "not_found":
                    not_found += 1
                else:
                    errors += 1
                if delay_seconds:
                    time.sleep(delay_seconds)
        else:
            # Workers only do the network I/O (download + parse) and hand
            # back a plain result; every con.execute()/commit() happens
            # here on the main thread, one result at a time as they arrive
            # -- sqlite3 connections don't tolerate concurrent use.
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {
                    pool.submit(_download_one, row["id"], row["cpf"], tmp_dir, delay_seconds): row
                    for row in targets
                }
                for future in as_completed(futures):
                    rc.tick()
                    outcome = _process_one(con, source_id, future.result())
                    if outcome == "fetched":
                        fetched += 1
                    elif outcome == "not_found":
                        not_found += 1
                    else:
                        errors += 1
        rc.done()

    remaining = con.execute(
        """SELECT count(DISTINCT p.id) FROM people p
           JOIN politician_history ph ON ph.person_id = p.id
           WHERE p.cpf IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM candidate_photo cp WHERE cp.person_id = p.id)"""
    ).fetchone()[0]
    total_cached = con.execute("SELECT count(DISTINCT person_id) FROM candidate_photo").fetchone()[0]
    total_urls = con.execute("SELECT count(*) FROM candidate_photo").fetchone()[0]

    log.info("done: %s fetched, %s not found, %s errors this run — %s people with a photo url "
             "cached (%s still unchecked), %s urls total",
             fetched, not_found, errors, f"{total_cached:,}", f"{remaining:,}", f"{total_urls:,}")
    return {"fetched": fetched, "not_found": not_found, "errors": errors,
            "total_cached": total_cached, "remaining": remaining, "total_urls": total_urls}


class _FetchResult:
    __slots__ = ("person_id", "cpf", "path", "status", "ctype", "error")

    def __init__(self, person_id: int, cpf: str, path: Path | None, status: int | None,
                ctype: str | None, error: Exception | None):
        self.person_id = person_id
        self.cpf = cpf
        self.path = path
        self.status = status
        self.ctype = ctype
        self.error = error


def _download_one(person_id: int, cpf: str, tmp_dir: Path, delay_seconds: float = 0) -> _FetchResult:
    """Thread-safe: network I/O only, no sqlite access."""
    if delay_seconds:
        time.sleep(delay_seconds)
    url = URL_TEMPLATE.format(cpf=cpf)
    path = tmp_dir / f"divulgacand_foto_{person_id}.json"
    try:
        status, ctype = download(url, path)
        return _FetchResult(person_id, cpf, path, status, ctype, None)
    except Exception as e:  # noqa: BLE001 -- a bad response must not kill the whole batch
        return _FetchResult(person_id, cpf, None, None, None, e)


def _process_one(con: sqlite3.Connection, source_id: int, fetch: _FetchResult) -> str:
    """Main-thread only: all sqlite reads/writes for one person's result."""
    person_id, cpf, path = fetch.person_id, fetch.cpf, fetch.path
    if fetch.error is not None:
        log.warning("  person %s (cpf %s): %s", person_id, cpf, fetch.error)
        return "error"

    url = URL_TEMPLATE.format(cpf=cpf)
    try:
        payload = json.loads(path.read_bytes())
    except (json.JSONDecodeError, OSError) as e:
        path.unlink(missing_ok=True)
        log.warning("  person %s (cpf %s): bad response (%s)", person_id, cpf, e)
        return "error"

    items = payload.get("items") if isinstance(payload, dict) else None
    if not items:
        path.unlink(missing_ok=True)
        return "not_found"

    # Exact CPF match -- every item back is this person's own candidacy, no
    # homonym filtering needed (unlike the earlier name-search version).
    matches = []
    for it in items:
        sq = str(it.get("id") or "")
        foto = it.get("fotoURl") or it.get("fotoUrl")
        if sq and foto:
            matches.append((sq, it.get("eleicao", {}).get("ano"), foto))

    if not matches:
        path.unlink(missing_ok=True)
        return "not_found"

    collection_id, _ = record_collection(
        con, source_id=source_id, url=url, file=path, http_status=fetch.status, content_type=fetch.ctype,
        notes=f"DivulgaCandContas CPF search for person_id {person_id}.")
    parse_id = record_parse(con, collection_id=collection_id, parser_name=PARSER_NAME,
                            parser_version=PARSER_VERSION, rows_extracted=len(matches), rows_rejected=0)
    now = now_utc()
    for sq, year, foto_url in matches:
        hist_row = con.execute(
            "SELECT id FROM politician_history WHERE tse_candidacy_id = ?", (sq,)
        ).fetchone()
        con.execute(
            "INSERT OR IGNORE INTO candidate_photo "
            "(person_id, history_id, tse_candidacy_id, year, photo_url, provenance_id, collected_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (person_id, hist_row["id"] if hist_row else None, sq, year, foto_url, parse_id, now),
        )
    con.commit()
    path.unlink(missing_ok=True)
    return "fetched"
