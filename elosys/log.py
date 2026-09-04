"""Console logging for the crawlers.

Every crawler logs to stderr with timestamps, and prints a short summary block
per step. The goal is that running `elosys tse-accounts` reads like a report:
what URL was hit, how big the file was, its hash, how many rows came out.
"""

from __future__ import annotations

import logging
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager

_CONFIGURED = False


def get_logger(name: str = "elosys") -> logging.Logger:
    global _CONFIGURED
    if not _CONFIGURED:
        stream = sys.stderr
        # Windows consoles default to cp1252 and choke on non-ASCII; force UTF-8.
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass
        handler = logging.StreamHandler(stream)
        handler.setFormatter(logging.Formatter("%(asctime)s  %(name)-22s  %(message)s", "%H:%M:%S"))
        root = logging.getLogger("elosys")
        root.addHandler(handler)
        root.setLevel(logging.INFO)
        _CONFIGURED = True
    return logging.getLogger(name)


@contextmanager
def step(log: logging.Logger, label: str) -> Iterator[None]:
    """Bracket a unit of work with '▶ label' / '✓ label (Ns)'."""
    log.info("[>] %s", label)
    start = time.monotonic()
    try:
        yield
    finally:
        log.info("[ok] %s  (%.1fs)", label, time.monotonic() - start)


def human_bytes(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


class RowCounter:
    """Logs progress every `every` rows while iterating a large file."""

    def __init__(self, log: logging.Logger, label: str, every: int = 250_000):
        self.log = log
        self.label = label
        self.every = every
        self.n = 0

    def tick(self, k: int = 1) -> None:
        self.n += k
        if self.n % self.every < k:
            self.log.info("  %s: %s rows", self.label, f"{self.n:,}")

    def done(self) -> int:
        self.log.info("  %s: %s rows total", self.label, f"{self.n:,}")
        return self.n
