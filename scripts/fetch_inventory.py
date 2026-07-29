#!/usr/bin/env python3
"""Headless Warframe inventory dump (Linux / Proton).

Scans Warframe.x64.exe memory for the mobile-API auth query string,
then GETs https://mobile.warframe.com/api/inventory.php?...

Requires:
  - Warframe running and logged in
  - same user as the game
  - kernel.yama.ptrace_scope == 0  (sudo sysctl kernel.yama.ptrace_scope=0)

Risk: unsanctioned memory read + unofficial API use. DE does not endorse this.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

PROCESS_NAMES = ("Warframe.x64.exe", "Warframe.x64.ex")
AUTHZ_PATTERN = b"?accountId="
ACCOUNT_ID_LEN = 24
NONCE_PREFIX = b"&nonce="
CONFIDENCE = 3
CHUNK = 1 << 20
INVENTORY_URL = "https://mobile.warframe.com/api/inventory.php"
SKIP_MAP_NAMES = {"[vdso]", "[vvar]", "[vsyscall]"}


def find_warframe_pid() -> int:
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            name = (entry / "comm").read_text().rstrip("\n")
        except OSError:
            continue
        if name in PROCESS_NAMES:
            return int(entry.name)
    raise RuntimeError("Warframe process not found (is the game running?)")


def readable_regions(pid: int) -> list[tuple[int, int]]:
    regions: list[tuple[int, int]] = []
    maps = Path(f"/proc/{pid}/maps").read_text().splitlines()
    for line in maps:
        fields = line.split()
        if len(fields) < 2:
            continue
        perms = fields[1]
        if not perms.startswith("r"):
            continue
        name = fields[5] if len(fields) >= 6 else ""
        if name in SKIP_MAP_NAMES or name.startswith("/dev/"):
            continue
        start_s, end_s = fields[0].split("-", 1)
        start, end = int(start_s, 16), int(end_s, 16)
        if end > start:
            regions.append((start, end))
    return regions


def extract_authz(buf: bytes, final: bool) -> tuple[str | None, str]:
    """Return (authz, status) where status is complete|incomplete|invalid."""
    need = len(AUTHZ_PATTERN) + ACCOUNT_ID_LEN
    if len(buf) < need:
        return None, "invalid" if final else "incomplete"

    offset = len(AUTHZ_PATTERN)
    account_id = buf[offset : offset + ACCOUNT_ID_LEN]
    offset += ACCOUNT_ID_LEN
    try:
        account_id.decode("ascii")
    except UnicodeDecodeError:
        return None, "invalid"

    if len(buf) < offset + len(NONCE_PREFIX):
        return None, "invalid" if final else "incomplete"
    if not buf.startswith(NONCE_PREFIX, offset):
        return None, "invalid"
    offset += len(NONCE_PREFIX)

    digit_start = offset
    while offset < len(buf) and 48 <= buf[offset] <= 57:
        offset += 1

    if offset == digit_start:
        return None, "invalid" if (offset < len(buf) or final) else "incomplete"
    if offset == len(buf) and not final:
        return None, "incomplete"

    authz = (
        AUTHZ_PATTERN
        + account_id
        + NONCE_PREFIX
        + buf[digit_start:offset]
    ).decode("ascii")
    return authz, "complete"


def scan_authz(pid: int) -> str:
    regions = readable_regions(pid)
    mem = open(f"/proc/{pid}/mem", "rb", buffering=0)
    candidates: Counter[str] = Counter()
    pattern = AUTHZ_PATTERN

    try:
        for start, end in regions:
            size = end - start
            carry = b""
            offset = 0
            while offset < size:
                n = min(CHUNK, size - offset)
                try:
                    mem.seek(start + offset)
                    chunk = mem.read(n)
                except OSError:
                    break
                if not chunk:
                    break

                combined = carry + chunk
                final = offset + len(chunk) >= size
                pos = 0
                carry_start = -1
                while True:
                    idx = combined.find(pattern, pos)
                    if idx < 0:
                        break
                    authz, status = extract_authz(combined[idx:], final)
                    if status == "complete" and authz:
                        candidates[authz] += 1
                        if candidates[authz] >= CONFIDENCE:
                            return authz
                    elif status == "incomplete":
                        carry_start = idx
                        break
                    pos = idx + len(pattern)

                if final:
                    carry = b""
                elif carry_start >= 0:
                    carry = combined[carry_start:]
                else:
                    tail = max(0, len(combined) - len(pattern) + 1)
                    carry = combined[tail:]

                offset += len(chunk)
    finally:
        mem.close()

    raise RuntimeError(
        "authz not found in process memory "
        f"(ptrace_scope={_ptrace_scope()}; try: sudo sysctl kernel.yama.ptrace_scope=0)"
    )


def _ptrace_scope() -> str:
    try:
        return Path("/proc/sys/kernel/yama/ptrace_scope").read_text().strip()
    except OSError:
        return "?"


def fetch_inventory(authz: str) -> bytes:
    url = INVENTORY_URL + authz
    req = urllib.request.Request(url, headers={"User-Agent": "warframe-inventory-export/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"inventory HTTP {e.code}: {e.reason}") from e
    # validate + pretty
    data = json.loads(raw)
    return json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8") + b"\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Dump Warframe inventory JSON (no UI)")
    ap.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("data/inventory_raw.json"),
        help="output path",
    )
    ap.add_argument("--print-authz", action="store_true", help="print authz only (debug)")
    args = ap.parse_args()

    scope = _ptrace_scope()
    if scope not in {"0", "?"}:
        print(
            f"warn: ptrace_scope={scope} (often blocks /proc/PID/mem). "
            "If scan fails: sudo sysctl kernel.yama.ptrace_scope=0",
            file=sys.stderr,
        )

    pid = find_warframe_pid()
    print(f"Warframe pid={pid}", file=sys.stderr)
    print("scanning memory for session token…", file=sys.stderr)
    authz = scan_authz(pid)
    if args.print_authz:
        # redact nonce digits partially
        redacted = re.sub(r"(nonce=)\d+", r"\1***", authz)
        print(redacted)
        return 0

    print("fetching inventory…", file=sys.stderr)
    pretty = fetch_inventory(authz)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(pretty)
    print(f"wrote {args.output} ({len(pretty)} bytes)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        raise SystemExit(130)
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        raise SystemExit(1)
