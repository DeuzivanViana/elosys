"""Elosys CLI — one independent crawler per data source (see ADs/imutabilidade.md).

    elosys init-db          --db elosys.db
    elosys tse-candidates   --db elosys.db --years 2018,2020,2022,2024,2026
    elosys tse-accounts     --db elosys.db --years 2018,2020,2022,2024,2026
    elosys manifest         --db elosys.db --out manifest.json
    elosys verify           --db elosys.db      (re-downloads sources, checks hashes)

Each crawler is rewrite-only: it wipes the tables it owns and rebuilds them from
the public files. Run them in any order; `tse-accounts` links identity better if
`tse-candidates` ran first. Every run refreshes `manifest.json` and writes a
`<crawler>_report.json` — commit both.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .db import connect, create_schema
from .log import get_logger
from .provenance import verify, write_manifest
from .tse import accounts, candidates

DEFAULT_TMP = "dados_tmp"
log = get_logger("elosys.cli")


def _init_db(args: argparse.Namespace) -> int:
    create_schema(args.db)
    log.info("schema applied to %s", args.db)
    return 0


def _run_crawler(args: argparse.Namespace, module, name: str) -> int:
    db = Path(args.db)
    create_schema(db)  # idempotent (all IF NOT EXISTS); adds any new tables to an existing db
    years = [int(y) for y in args.years.split(",")] if args.years else None
    con = connect(db, write=True)
    try:
        report = module.run(con, years=years, tmp_dir=args.tmp)
        write_manifest(con, db.with_name("manifest.json"))
    finally:
        con.close()
    report_path = db.with_name(f"{name}_report.json")
    report_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
    log.info("wrote %s and refreshed manifest.json — commit both", report_path.name)
    return 0


def _manifest(args: argparse.Namespace) -> int:
    con = connect(args.db)
    try:
        write_manifest(con, args.out)
    finally:
        con.close()
    log.info("wrote %s", args.out)
    return 0


def _verify(args: argparse.Namespace) -> int:
    con = connect(args.db)
    try:
        mismatches = verify(con)
    finally:
        con.close()
    if mismatches:
        for m in mismatches:
            print(f"CHANGED: {m['url']}\n  expected {m['expected']}\n  got      {m['got']}",
                  file=sys.stderr)
        return 1
    log.info("all source files still match the manifest — the build is reproducible")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="elosys")
    p.add_argument("--version", action="version", version=f"elosys {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("init-db", help="create the database and apply the schema")
    pi.add_argument("--db", default="elosys.db")
    pi.set_defaults(func=_init_db)

    for cmd, mod, name, helptext in (
        ("tse-candidates", candidates, "tse_candidates", "ingest TSE consulta_cand -> politician_history"),
        ("tse-accounts", accounts, "tse_accounts", "ingest TSE prestação de contas -> campaign_org"),
    ):
        sp = sub.add_parser(cmd, help=helptext)
        sp.add_argument("--db", default="elosys.db")
        sp.add_argument("--years", help="e.g. 2018,2020,2022,2024,2026 (default: all supported)")
        sp.add_argument("--tmp", default=DEFAULT_TMP, help="temporary download directory")
        sp.set_defaults(func=lambda a, _m=mod, _n=name: _run_crawler(a, _m, _n))

    pm = sub.add_parser("manifest", help="write the input manifest (sources + hashes)")
    pm.add_argument("--db", default="elosys.db")
    pm.add_argument("--out", default="manifest.json")
    pm.set_defaults(func=_manifest)

    pv = sub.add_parser("verify", help="re-download sources and check hashes against the build")
    pv.add_argument("--db", default="elosys.db")
    pv.set_defaults(func=_verify)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
