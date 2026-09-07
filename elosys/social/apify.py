"""Cliente mínimo da Apify (https://apify.com) para o ator de scraping do X.

O token é lido de APIFY_TOKEN no ambiente APENAS — nunca de arquivo, nunca
commitado (mesma regra da DEEPSEEK_API_KEY). Pegue um em
https://console.apify.com/account/integrations e:

    export APIFY_TOKEN=apify_api_...        # bash/zsh
    $env:APIFY_TOKEN = "apify_api_..."      # PowerShell

Ator (default): kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest
— ~US$ 0,25 / 1.000 resultados, aceita `searchTerms` com operadores do X
(`from:`, `since:`, `OR`, `-filter:retweets`) e — ao contrário do
apidojo/tweet-scraper — funciona via API no plano Free da Apify.
Trocável por APIFY_ACTOR no ambiente (formato `username~actor-name`).
"""

from __future__ import annotations

import os
import time

from curl_cffi import requests

BASE = "https://api.apify.com/v2"
DEFAULT_ACTOR = "kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest"


def _actor() -> str:
    return os.environ.get("APIFY_ACTOR", DEFAULT_ACTOR)

_START_TIMEOUT = 60
_POLL_TIMEOUT = 60
_ITEMS_TIMEOUT = 180
_DONE = {"SUCCEEDED"}
_FAILED = {"FAILED", "ABORTED", "TIMED-OUT", "TIMED_OUT"}
# Free plan caps concurrent actor runs (5). Rather than fail the batch, wait for
# a slot — the ThreadPoolExecutor then self-throttles to whatever the plan allows.
_CONCURRENCY_RETRY_WAIT = 30
_CONCURRENCY_RETRIES = 40


class ApifyError(RuntimeError):
    pass


def has_token() -> bool:
    return bool(os.environ.get("APIFY_TOKEN"))


def _token() -> str:
    t = os.environ.get("APIFY_TOKEN")
    if not t:
        raise ApifyError("APIFY_TOKEN não definida no ambiente (export APIFY_TOKEN=apify_api_...)")
    return t


def run_actor(
    actor_input: dict,
    *,
    poll_seconds: float = 5.0,
    max_wait_seconds: int = 1800,
    memory_mbytes: int = 512,
) -> tuple[str, list[dict]]:
    """Start the actor, wait for it, return (run_id, dataset_items).

    Raises ApifyError on any HTTP failure or a failed/aborted run. Safe to call
    from a worker thread (no shared state; each run is independent).
    """
    token = _token()
    actor = _actor()

    r = None
    for attempt in range(_CONCURRENCY_RETRIES + 1):
        try:
            r = requests.post(
                f"{BASE}/acts/{actor}/runs?token={token}&memory={memory_mbytes}",
                json=actor_input, timeout=_START_TIMEOUT,
            )
        except Exception as e:  # noqa: BLE001
            raise ApifyError(f"falha ao iniciar o ator: {e}") from e
        if r.status_code == 402 and "concurrent" in r.text.lower():
            if attempt < _CONCURRENCY_RETRIES:
                time.sleep(_CONCURRENCY_RETRY_WAIT)
                continue
            raise ApifyError("limite de execuções concorrentes da Apify — reduza --workers")
        break
    if r is None or r.status_code not in (200, 201):
        raise ApifyError(f"start HTTP {getattr(r, 'status_code', '?')}: {getattr(r, 'text', '')[:300]}")

    data = r.json()["data"]
    run_id = data["id"]
    dataset_id = data["defaultDatasetId"]

    waited = 0.0
    status = data.get("status", "RUNNING")
    while status not in _DONE:
        if status in _FAILED:
            raise ApifyError(f"run {run_id} terminou como {status}")
        if waited >= max_wait_seconds:
            raise ApifyError(f"run {run_id} ainda em {status} após {max_wait_seconds}s")
        time.sleep(poll_seconds)
        waited += poll_seconds
        try:
            s = requests.get(f"{BASE}/actor-runs/{run_id}?token={token}", timeout=_POLL_TIMEOUT)
            status = s.json()["data"]["status"]
        except Exception as e:  # noqa: BLE001 (transient poll failure — keep waiting)
            status = "RUNNING"
            _ = e

    return run_id, _fetch_items(dataset_id, token)


def _fetch_items(dataset_id: str, token: str) -> list[dict]:
    items: list[dict] = []
    offset = 0
    page_size = 1000
    while True:
        r = requests.get(
            f"{BASE}/datasets/{dataset_id}/items"
            f"?token={token}&clean=true&offset={offset}&limit={page_size}",
            timeout=_ITEMS_TIMEOUT,
        )
        if r.status_code != 200:
            raise ApifyError(f"items HTTP {r.status_code}: {r.text[:300]}")
        page = r.json()
        if not page:
            break
        items.extend(page)
        if len(page) < page_size:
            break
        offset += len(page)
    return items
