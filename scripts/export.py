#!/usr/bin/env python3
"""One-shot: fetch inventory + categorize."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser(description="Fetch + categorize Warframe inventory")
    ap.add_argument("--account", default="B4uklotze")
    ap.add_argument("--lists-only", action="store_true")
    ap.add_argument("--skip-fetch", action="store_true", help="only categorize existing raw JSON")
    args = ap.parse_args()

    raw = ROOT / "data" / "inventory_raw.json"
    out = ROOT / "data" / "inventory_categorized.json"

    if not args.skip_fetch:
        r = subprocess.run([sys.executable, str(ROOT / "fetch_inventory.py"), "-o", str(raw)])
        if r.returncode != 0:
            return r.returncode

    cmd = [
        sys.executable,
        str(ROOT / "categorize.py"),
        "-i",
        str(raw),
        "-o",
        str(out),
        "--account",
        args.account,
    ]
    if args.lists_only:
        cmd.append("--lists-only")
    return subprocess.run(cmd).returncode


if __name__ == "__main__":
    raise SystemExit(main())
