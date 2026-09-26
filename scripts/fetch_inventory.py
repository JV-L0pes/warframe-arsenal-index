#!/usr/bin/env python3
"""Headless Warframe inventory dump (Linux / Windows).

Scans Warframe.x64.exe memory for the mobile-API auth query string,
then GETs https://mobile.warframe.com/api/inventory.php?...

Requires:
  - Warframe running and logged in
  - same user as the game (or admin on Windows if access is denied)
  - Linux: kernel.yama.ptrace_scope == 0  (sudo sysctl kernel.yama.ptrace_scope=0)

Risk: unsanctioned memory read + unofficial API use. DE does not endorse this.
"""

from __future__ import annotations

import argparse
import json
import platform
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

PROCESS_NAMES = ("Warframe.x64.exe", "Warframe.x64.ex", "Warframe.exe")
AUTHZ_PATTERN = b"?accountId="
ACCOUNT_ID_LEN = 24
NONCE_PREFIX = b"&nonce="
CONFIDENCE = 3
CHUNK = 1 << 20
INVENTORY_URL = "https://mobile.warframe.com/api/inventory.php"
SKIP_MAP_NAMES = {"[vdso]", "[vvar]", "[vsyscall]"}
IS_WINDOWS = sys.platform == "win32"
IS_LINUX = sys.platform.startswith("linux")


def find_warframe_pid() -> int:
    if IS_WINDOWS:
        return _find_warframe_pid_windows()
    if IS_LINUX:
        return _find_warframe_pid_linux()
    raise RuntimeError(f"unsupported platform: {platform.system()}")


def _find_warframe_pid_linux() -> int:
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


def _find_warframe_pid_windows() -> int:
    import ctypes
    from ctypes import wintypes

    TH32CS_SNAPPROCESS = 0x00000002
    INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32FirstW.restype = wintypes.BOOL
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32NextW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap in (None, 0, INVALID_HANDLE_VALUE):
        raise RuntimeError("CreateToolhelp32Snapshot failed")

    entry = PROCESSENTRY32W()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
    try:
        ok = kernel32.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            name = entry.szExeFile
            if name in PROCESS_NAMES:
                return int(entry.th32ProcessID)
            ok = kernel32.Process32NextW(snap, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snap)

    raise RuntimeError("Warframe process not found (is the game running?)")


def readable_regions(pid: int) -> list[tuple[int, int]]:
    if IS_WINDOWS:
        return _readable_regions_windows(pid)
    return _readable_regions_linux(pid)


def _readable_regions_linux(pid: int) -> list[tuple[int, int]]:
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


def _readable_regions_windows(pid: int) -> list[tuple[int, int]]:
    import ctypes
    from ctypes import wintypes

    PROCESS_QUERY_INFORMATION = 0x0400
    PROCESS_VM_READ = 0x0010
    MEM_COMMIT = 0x1000
    PAGE_NOACCESS = 0x01
    PAGE_GUARD = 0x100

    class MEMORY_BASIC_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BaseAddress", ctypes.c_void_p),
            ("AllocationBase", ctypes.c_void_p),
            ("AllocationProtect", wintypes.DWORD),
            ("RegionSize", ctypes.c_size_t),
            ("State", wintypes.DWORD),
            ("Protect", wintypes.DWORD),
            ("Type", wintypes.DWORD),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.VirtualQueryEx.argtypes = [
        wintypes.HANDLE,
        ctypes.c_void_p,
        ctypes.POINTER(MEMORY_BASIC_INFORMATION),
        ctypes.c_size_t,
    ]
    kernel32.VirtualQueryEx.restype = ctypes.c_size_t

    handle = kernel32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not handle:
        err = ctypes.get_last_error()
        raise RuntimeError(
            f"OpenProcess failed (WinError {err}). "
            "Run the terminal as Administrator, or ensure Warframe is running as the same user."
        )

    regions: list[tuple[int, int]] = []
    address = 0
    mbi = MEMORY_BASIC_INFORMATION()
    max_addr = (1 << 48) - 1  # user-space ceiling for x64
    try:
        while address < max_addr:
            got = kernel32.VirtualQueryEx(
                handle,
                ctypes.c_void_p(address),
                ctypes.byref(mbi),
                ctypes.sizeof(mbi),
            )
            if not got:
                break
            base = mbi.BaseAddress or 0
            size = int(mbi.RegionSize)
            protect = int(mbi.Protect)
            if (
                mbi.State == MEM_COMMIT
                and size > 0
                and not (protect & PAGE_NOACCESS)
                and not (protect & PAGE_GUARD)
            ):
                regions.append((base, base + size))
            nxt = base + size
            if nxt <= address:
                break
            address = nxt
    finally:
        kernel32.CloseHandle(handle)
    return regions


def open_process_memory(pid: int):
    if IS_WINDOWS:
        return _WindowsMemory(pid)
    return open(f"/proc/{pid}/mem", "rb", buffering=0)


class _WindowsMemory:
    """Minimal file-like reader over ReadProcessMemory."""

    def __init__(self, pid: int) -> None:
        import ctypes
        from ctypes import wintypes

        self._ctypes = ctypes
        self._wintypes = wintypes
        PROCESS_QUERY_INFORMATION = 0x0400
        PROCESS_VM_READ = 0x0010

        self._kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self._kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self._kernel32.OpenProcess.restype = wintypes.HANDLE
        self._kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        self._kernel32.CloseHandle.restype = wintypes.BOOL
        self._kernel32.ReadProcessMemory.argtypes = [
            wintypes.HANDLE,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_size_t,
            ctypes.POINTER(ctypes.c_size_t),
        ]
        self._kernel32.ReadProcessMemory.restype = wintypes.BOOL

        self._handle = self._kernel32.OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid
        )
        if not self._handle:
            err = ctypes.get_last_error()
            raise RuntimeError(
                f"OpenProcess failed (WinError {err}). "
                "Run the terminal as Administrator, or ensure Warframe is running as the same user."
            )
        self._pos = 0

    def seek(self, pos: int, whence: int = 0) -> int:
        if whence != 0:
            raise OSError("only SEEK_SET supported")
        self._pos = pos
        return self._pos

    def read(self, n: int) -> bytes:
        buf = (self._ctypes.c_char * n)()
        read = self._ctypes.c_size_t(0)
        ok = self._kernel32.ReadProcessMemory(
            self._handle,
            self._ctypes.c_void_p(self._pos),
            buf,
            n,
            self._ctypes.byref(read),
        )
        if not ok or read.value == 0:
            return b""
        self._pos += read.value
        return buf[: read.value]

    def close(self) -> None:
        if self._handle:
            self._kernel32.CloseHandle(self._handle)
            self._handle = None


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
    mem = open_process_memory(pid)
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

    if IS_WINDOWS:
        raise RuntimeError(
            "authz not found in process memory "
            "(is Warframe logged in? try running the terminal as Administrator)"
        )
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

    if IS_LINUX:
        scope = _ptrace_scope()
        if scope not in {"0", "?"}:
            print(
                f"warn: ptrace_scope={scope} (often blocks /proc/PID/mem). "
                "If scan fails: sudo sysctl kernel.yama.ptrace_scope=0",
                file=sys.stderr,
            )
    elif not IS_WINDOWS:
        print(f"error: unsupported platform {platform.system()}", file=sys.stderr)
        return 1

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
