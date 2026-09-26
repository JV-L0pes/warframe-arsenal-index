#!/usr/bin/env python3
"""Decode Warframe Public Export .lzma (LZMA Alone) streams.

CPython 3.14's ``lzma.FORMAT_ALONE`` rejects DE's index files as corrupt.
Parsing the 13-byte header and decompressing with ``FORMAT_RAW`` works.
"""

from __future__ import annotations

import lzma
import struct


def decompress_public_export_lzma(raw: bytes) -> bytes:
    if len(raw) < 14:
        raise ValueError("lzma stream too short")

    # Prefer stock Alone/Auto when they work (older CPython).
    for fmt in (lzma.FORMAT_AUTO, lzma.FORMAT_ALONE):
        try:
            return lzma.decompress(raw, format=fmt)
        except lzma.LZMAError:
            pass

    props = raw[0]
    dict_size = struct.unpack_from("<I", raw, 1)[0]
    if dict_size == 0 or dict_size > (1 << 30):
        raise ValueError(f"invalid lzma dict_size={dict_size}")

    lc = props % 9
    lp = (props // 9) % 5
    pb = props // 45
    filters = [
        {
            "id": lzma.FILTER_LZMA1,
            "lc": lc,
            "lp": lp,
            "pb": pb,
            "dict_size": dict_size,
        }
    ]
    # Skip 13-byte Alone header (props + dict + uncompressed size).
    return lzma.decompress(raw[13:], format=lzma.FORMAT_RAW, filters=filters)
