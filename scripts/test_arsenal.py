#!/usr/bin/env python3
"""Minimal unittest coverage for pure helpers (no network)."""

from __future__ import annotations

import lzma
import struct
import unittest

from categorize import mod_bucket, weapon_subtype
from fetch_inventory import ACCOUNT_ID_LEN, extract_authz
from lzma_export import decompress_public_export_lzma


class LzmaExportTest(unittest.TestCase):
    DATA = b"ExportUpgrades_en.json!deadbeef\n" * 64

    def test_reads_standard_alone_stream(self):
        raw = lzma.compress(self.DATA, format=lzma.FORMAT_ALONE)
        self.assertEqual(decompress_public_export_lzma(raw), self.DATA)

    def test_reads_header_plus_raw_payload_stream(self):
        filters = [
            {"id": lzma.FILTER_LZMA1, "lc": 3, "lp": 0, "pb": 2, "dict_size": 1 << 20}
        ]
        comp = lzma.LZMACompressor(format=lzma.FORMAT_RAW, filters=filters)
        payload = comp.compress(self.DATA) + comp.flush()
        props = 3 + 2 * 45
        header = (
            bytes([props])
            + struct.pack("<I", 1 << 20)
            + struct.pack("<Q", 0xFFFF_FFFF_FFFF_FFFF)
        )
        self.assertEqual(decompress_public_export_lzma(header + payload), self.DATA)

    def test_rejects_short_stream(self):
        with self.assertRaises(ValueError):
            decompress_public_export_lzma(b"tiny")


class AuthzExtractTest(unittest.TestCase):
    ID = b"a1b2c3d4e5f6a7b8c9d0e1f2"

    def test_complete(self):
        buf = b"?accountId=" + self.ID + b"&nonce=98765"
        authz, status = extract_authz(buf, final=True)
        self.assertEqual(status, "complete")
        self.assertEqual(authz, buf.decode("ascii"))

    def test_incomplete_while_stream_continues(self):
        buf = b"?accountId=" + self.ID + b"&nonce=12"
        authz, status = extract_authz(buf, final=False)
        self.assertIsNone(authz)
        self.assertEqual(status, "incomplete")

    def test_invalid_when_nonce_missing(self):
        buf = b"?accountId=" + self.ID + b"&other=1"
        authz, status = extract_authz(buf, final=True)
        self.assertIsNone(authz)
        self.assertEqual(status, "invalid")


class CategorizeTest(unittest.TestCase):
    def test_mod_bucket_prefers_meta_over_path(self):
        self.assertEqual(mod_bucket("/Lotus/x", {"type": "Rifle"}), "rifle")
        self.assertEqual(mod_bucket("/Lotus/x", {"compatName": "Shotgun"}), "shotgun")

    def test_mod_bucket_falls_back_to_path(self):
        self.assertEqual(mod_bucket("/Lotus/Upgrades/Mods/Warframe/Foo", None), "warframe")

    def test_pistol_crossbow_is_not_a_bow(self):
        meta = {"productCategory": "Pistols", "name": "Bolto"}
        self.assertEqual(
            weapon_subtype("/Lotus/Weapons/Tenno/Pistol/CrossBow/Bolto", meta),
            "pistol",
        )

    def test_melee_type_is_normalized(self):
        meta = {"productCategory": "Melee", "name": "Nikana", "type": "Nikana"}
        self.assertEqual(
            weapon_subtype("/Lotus/Weapons/Tenno/Melee/Nikana", meta), "nikana"
        )


if __name__ == "__main__":
    unittest.main()
