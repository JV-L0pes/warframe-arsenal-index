#!/usr/bin/env python3
"""Download Arsenyx Overframe id→name CSV into web/public/data/overframe-items.csv."""

from __future__ import annotations

import base64
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "overframe-items.csv"
API = (
    "https://api.github.com/repos/Reuzehagel/arsenyx/contents/"
    "apps/api/src/lib/overframe/data/items-csv.ts"
)


def main() -> int:
    req = urllib.request.Request(
        API,
        headers={
            "User-Agent": "warframe-arsenal-index/1.0",
            "Accept": "application/vnd.github+json",
        },
    )
    meta = json.loads(urllib.request.urlopen(req, timeout=60).read())
    raw = base64.b64decode(meta["content"])
    text = raw.decode("utf-8")

    # export const OVERFRAME_ITEMS_CSV = 'id,name\r\n...'
    m = re.search(
        r"OVERFRAME_ITEMS_CSV\s*=\s*'((?:\\'|[^'])*)'",
        text,
        re.S,
    )
    if not m:
        raise SystemExit("could not parse OVERFRAME_ITEMS_CSV string")

    csv = (
        m.group(1)
        .replace(r"\r", "\r")
        .replace(r"\n", "\n")
        .replace(r"\t", "\t")
        .replace(r"\'", "'")
        .replace(r"\\", "\\")
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(csv, encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {csv.count(chr(10))+1} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
