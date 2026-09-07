"""Thin DeepSeek chat client (OpenAI-compatible API).

Used by elosys/rules/ai_review.py to get a cheap second opinion on detection
signals. The API key is read from the DEEPSEEK_API_KEY environment variable
ONLY -- never a config file, never committed. Get one at
https://platform.deepseek.com/ and:

    export DEEPSEEK_API_KEY=sk-...        # bash/zsh
    $env:DEEPSEEK_API_KEY = "sk-..."      # PowerShell
"""

from __future__ import annotations

import json
import os

from curl_cffi import requests

API_URL = "https://api.deepseek.com/chat/completions"
DEFAULT_MODEL = "deepseek-chat"


class DeepSeekError(RuntimeError):
    pass


def has_key() -> bool:
    return bool(os.environ.get("DEEPSEEK_API_KEY"))


def chat_json(
    system_prompt: str,
    user_prompt: str,
    *,
    model: str = DEFAULT_MODEL,
    temperature: float = 0.2,
    timeout: int = 120,
) -> dict:
    """One chat completion, forced to return a JSON object. Returns
    {"data": <parsed dict>, "raw": <raw content str>, "prompt_tokens": int,
    "completion_tokens": int}. Raises DeepSeekError on HTTP/parse failure."""
    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        raise DeepSeekError(
            "DEEPSEEK_API_KEY não definida no ambiente (export DEEPSEEK_API_KEY=sk-...)"
        )

    try:
        r = requests.post(
            API_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "response_format": {"type": "json_object"},
                "temperature": temperature,
                "stream": False,
            },
            timeout=timeout,
        )
    except Exception as e:  # noqa: BLE001 -- curl_cffi raises a few different things
        raise DeepSeekError(f"falha de rede: {e}") from e

    if r.status_code != 200:
        raise DeepSeekError(f"HTTP {r.status_code}: {r.text[:400]}")

    try:
        body = r.json()
        content = body["choices"][0]["message"]["content"]
        usage = body.get("usage") or {}
    except (KeyError, IndexError, ValueError) as e:
        raise DeepSeekError(f"resposta inesperada da API: {r.text[:400]}") from e

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise DeepSeekError(f"modelo não devolveu JSON válido: {content[:400]}") from e

    return {
        "data": data,
        "raw": content,
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
    }
