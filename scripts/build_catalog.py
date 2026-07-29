#!/usr/bin/env python3
"""Build web/public/data/catalog.json (+ optional owned.json) from Public Export.

Self-contained: can download Public Export + warframestat itself (for CI).
"""

from __future__ import annotations

import argparse
import json
import lzma
import os
import re
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "data" / "cache"
OUT = ROOT.parent / "web" / "public" / "data"
INV = ROOT / "data" / "inventory_raw.json"
WFSTAT_WEAPONS = "https://api.warframestat.us/weapons"
MANIFEST_INDEX = "https://content.warframe.com/PublicExport/index_en.txt.lzma"
STALE_NOTE = "weapon subtypes prefer warframestat.us type by uniqueName"
UA = {"User-Agent": "warframe-arsenal-index/1.0 (+https://github.com/JV-L0pes/warframe-arsenal-index)"}

EXPORT_FILES = (
    "ExportUpgrades_en.json",
    "ExportWeapons_en.json",
    "ExportWarframes_en.json",
)

MOD_MAP = {
    "WARFRAME": "warframe",
    "AURA": "aura",
    "Rifle": "rifle",
    "Assault Rifle": "rifle",
    "PRIMARY": "rifle",
    "Shotgun": "shotgun",
    "Sniper": "sniper",
    "Bow": "bow",
    "Pistol": "pistol",
    "Melee": "melee",
    "Claws": "melee",
    "Thrown Melee": "melee",
    "STANCE": "stance",
    "Archwing": "archwing",
    "Archgun": "archgun",
    "Archmelee": "archmelee",
    "ROBOTIC": "robotic",
    "COMPANION": "companion",
    "BEAST": "beast",
    "Moa": "beast",
    "Hound": "beast",
    "Kubrow": "beast",
    "Kavat": "beast",
    "Parazon": "parazon",
    "Necramech": "necromech",
    "K-Drive": "kdrive",
    "Railjack": "railjack",
    "ANY": "universal",
}
CAT_NAMES = {k.upper() for k in MOD_MAP} | {
    "WARFRAME",
    "PRIMARY",
    "SECONDARY",
    "MELEE",
    "AURA",
    "STANCE",
}


def clean(name: str | None) -> str:
    return re.sub(r"\|[^|]*\|", "", name or "").strip()


def mod_cat(u: dict) -> str:
    path = u.get("uniqueName", "")
    if "/PvPMods/" in path or "/PvP/" in path:
        return "pvp"
    if "Riven" in path or "RandomMod" in path:
        return "riven"
    for key in (u.get("compatName"), u.get("type")):
        if not key:
            continue
        if key in MOD_MAP:
            return MOD_MAP[key]
        up = str(key).upper()
        for k, v in MOD_MAP.items():
            if k.upper() == up or k.upper() in up:
                return v
    if "/Warframe/" in path:
        return "warframe"
    if "/Aura/" in path:
        return "aura"
    if "/Rifle/" in path:
        return "rifle"
    if "/Shotgun/" in path:
        return "shotgun"
    if "/Pistol/" in path:
        return "pistol"
    if "/Melee/" in path:
        return "melee"
    if "/Stance/" in path:
        return "stance"
    return "other"


def mod_display_name(u: dict) -> str:
    name = clean(u.get("name"))
    un = u.get("uniqueName", "")
    # Beginner path = flawed starter; DE reuses the same display name.
    if "/Beginner/" in un and "(Flawed)" not in name:
        return f"{name} (Flawed)"
    return name


def is_augment(u: dict) -> bool:
    t = str(u.get("type") or "").upper()
    if t == "STANCE" or t == "AURA":
        return False
    cn = u.get("compatName") or ""
    if not cn:
        return False
    if cn.upper() in CAT_NAMES:
        return False
    if cn in (
        "Rifle",
        "Shotgun",
        "Pistol",
        "Melee",
        "Bow",
        "Sniper",
        "Claws",
        "Thrown Melee",
        "Moa",
        "Hound",
        "Assault Rifle",
        "PRIMARY",
        "SECONDARY",
    ):
        return False
    return True


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as resp:
        return resp.read()


def ensure_public_export(*, refresh: bool) -> None:
    """Download DE Public Export manifests into CACHE if missing (or always if refresh)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    needed = [CACHE / name for name in EXPORT_FILES]
    if not refresh and all(p.exists() for p in needed):
        return

    print("fetching Public Export index…", file=sys.stderr)
    index_text = lzma.decompress(http_get(MANIFEST_INDEX)).decode("utf-8", errors="replace")
    (CACHE / "index_en.txt").write_text(index_text, encoding="utf-8")

    urls: dict[str, str] = {}
    for line in index_text.splitlines():
        line = line.strip()
        if not line or "!" not in line:
            continue
        name = line.split("!", 1)[0]
        urls[name] = f"https://content.warframe.com/PublicExport/Manifest/{line}"

    for name in EXPORT_FILES:
        url = urls.get(name)
        if not url:
            raise RuntimeError(f"manifest missing {name}")
        print(f"  downloading {name}…", file=sys.stderr)
        raw = http_get(url)
        text = raw.decode("utf-8-sig", errors="replace")
        # validate JSON
        json.loads(text)
        (CACHE / name).write_text(text, encoding="utf-8")


def load_warframestat_weapon_types(*, refresh: bool) -> dict[str, str]:
    """uniqueName → normalized subtype (rifle, shotgun, …)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE / "warframestat_weapons.json"
    if refresh or not cache_path.exists():
        print("fetching warframestat weapons…", file=sys.stderr)
        data = json.loads(http_get(WFSTAT_WEAPONS).decode("utf-8"))
        cache_path.write_text(json.dumps(data), encoding="utf-8")
    else:
        data = json.loads(cache_path.read_text(encoding="utf-8"))

    mapping: dict[str, str] = {}
    if not isinstance(data, list):
        return mapping

    type_map = {
        "rifle": "rifle",
        "assault rifle": "rifle",
        "shotgun": "shotgun",
        "sniper rifle": "sniper",
        "sniper": "sniper",
        "bow": "bow",
        "pistol": "pistol",
        "dual pistols": "pistol",
        "thrown": "pistol",
        "melee": "melee",
        "blade and whip": "melee",
        "sword": "melee",
        "nikana": "melee",
        "spear": "speargun",
        "speargun": "speargun",
        "launcher": "launcher",
        "archgun": "archgun",
        "archmelee": "archmelee",
        "amp": "amp",
        "exalted weapon": "exalted",
    }

    for w in data:
        if not isinstance(w, dict):
            continue
        un = w.get("uniqueName")
        wtype = str(w.get("type") or "").strip().lower()
        if not un or not wtype:
            continue
        sub = type_map.get(wtype)
        if not sub:
            for needle, val in type_map.items():
                if needle in wtype:
                    sub = val
                    break
        if sub:
            mapping[un] = sub
    return mapping


def heuristic_subtype(slot: str, name: str, unique_name: str) -> str:
    blob = f"{name} {unique_name}"
    if slot == "primary":
        if re.search(
            r"Shotgun|Hek|Tigris|Strun|Boar|Corinth|Cedo|Drakgoon|FlakCannon|Convectrix",
            blob,
            re.I,
        ):
            return "shotgun"
        if re.search(r"Sniper|Vectis|Rubico|Lanka|Vulkar", blob, re.I):
            return "sniper"
        if re.search(r"/Bows?/|Nataruk|Paris|Cernos|Dread|Lenz", blob, re.I):
            return "bow"
        if re.search(r"Spear|Javlok|Scourge|Ferrox|Afentis", blob, re.I):
            return "speargun"
        if re.search(r"Launcher|Ogris|Torid|Penta|Zarr|Tonkor", blob, re.I):
            return "launcher"
        return "rifle"
    if slot == "secondary":
        if re.search(r"HandShotGun|Bronco|Pyrana|Kohmak|Detron", blob, re.I):
            return "shotgun"
        return "pistol"
    if slot == "melee":
        return "melee"
    return "other"


def main() -> int:
    ap = argparse.ArgumentParser(description="Build Arsenal Index catalog.json")
    ap.add_argument(
        "--refresh",
        action="store_true",
        help="re-download Public Export + warframestat (default in CI)",
    )
    ap.add_argument(
        "--skip-owned",
        action="store_true",
        help="do not write owned.json even if inventory_raw.json exists",
    )
    args = ap.parse_args()
    refresh = args.refresh or os.environ.get("CI") == "true"

    ensure_public_export(refresh=refresh)

    ups = json.loads((CACHE / "ExportUpgrades_en.json").read_text())["ExportUpgrades"]
    mods = []
    for u in ups:
        un = u.get("uniqueName", "")
        mods.append(
            {
                "uniqueName": un,
                "name": mod_display_name(u),
                "category": mod_cat(u),
                "compatName": u.get("compatName"),
                "type": u.get("type"),
                "rarity": u.get("rarity"),
                "polarity": u.get("polarity"),
                "baseDrain": u.get("baseDrain"),
                "fusionLimit": u.get("fusionLimit"),
                "isAugment": is_augment(u),
            }
        )

    weapons = json.loads((CACHE / "ExportWeapons_en.json").read_text())["ExportWeapons"]
    print("loading warframestat weapon types…", file=sys.stderr)
    wf_types = load_warframestat_weapon_types(refresh=refresh)
    print(f"  warframestat mapped: {len(wf_types)}", file=sys.stderr)
    source_counts: Counter[str] = Counter()
    wout = []
    for w in weapons:
        pc = w.get("productCategory") or ""
        slot = {
            "LongGuns": "primary",
            "Pistols": "secondary",
            "Melee": "melee",
            "SpaceGuns": "archgun",
            "SpaceMelee": "archmelee",
        }.get(pc, (pc or "other").lower())
        name = clean(w.get("name"))
        un = w["uniqueName"]
        if un in wf_types:
            sub = wf_types[un]
            src = "warframestat"
        elif slot == "archgun":
            sub, src = "archgun", "export"
        elif slot == "archmelee":
            sub, src = "archmelee", "export"
        elif slot == "melee":
            sub, src = "melee", "export"
        else:
            sub = heuristic_subtype(slot, name, un)
            src = "heuristic"
        source_counts[src] += 1
        wout.append(
            {
                "uniqueName": un,
                "name": name,
                "slot": slot,
                "subtype": sub,
                "subtypeSource": src,
            }
        )

    frames = json.loads((CACHE / "ExportWarframes_en.json").read_text())[
        "ExportWarframes"
    ]
    fout = [
        {
            "uniqueName": f["uniqueName"],
            "name": clean(f.get("name")),
            "productCategory": f.get("productCategory"),
        }
        for f in frames
        if f.get("productCategory") == "Suits"
        or "/Powersuits/" in f.get("uniqueName", "")
    ]

    catalog = {
        "generatedFrom": "Warframe Public Export + warframestat.us",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "filters": [
            "full Public Export (no mod skips)",
            STALE_NOTE,
        ],
        "weaponSubtypeSources": dict(source_counts),
        "counts": {
            "mods": len(mods),
            "weapons": len(wout),
            "warframes": len(fout),
        },
        "mods": sorted(mods, key=lambda x: x["name"].lower()),
        "weapons": sorted(wout, key=lambda x: x["name"].lower()),
        "warframes": sorted(fout, key=lambda x: x["name"].lower()),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False))
    print(
        f"catalog: {len(catalog['mods'])} mods, "
        f"{len(catalog['weapons'])} weapons, {len(catalog['warframes'])} frames"
    )
    print("mod cats", Counter(m["category"] for m in catalog["mods"]).most_common(8))

    print("weapon subtype sources", dict(source_counts), file=sys.stderr)

    if args.skip_owned:
        return 0

    if INV.exists():
        inv = json.loads(INV.read_text())
        synced_at = datetime.fromtimestamp(
            INV.stat().st_mtime, tz=timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        owned: dict = {
            "mods": {},
            "weapons": [],
            "warframes": [],
            "account": "B4uklotze",
            "syncedAt": synced_at,
            "source": "mobile-api",
        }
        for key in ("RawUpgrades", "Upgrades"):
            for e in inv.get(key) or []:
                if not isinstance(e, dict):
                    continue
                un = e.get("ItemType")
                if not un:
                    continue
                rank = None
                fp = e.get("UpgradeFingerprint")
                if isinstance(fp, str):
                    try:
                        rank = json.loads(fp).get("lvl")
                    except json.JSONDecodeError:
                        pass
                cur = owned["mods"].get(un) or {
                    "uniqueName": un,
                    "rank": None,
                    "count": 0,
                }
                cur["count"] += int(e.get("ItemCount") or 1)
                if rank is not None and (cur["rank"] is None or rank > cur["rank"]):
                    cur["rank"] = rank
                owned["mods"][un] = cur
        owned["mods"] = list(owned["mods"].values())
        for bin_key, slot in (
            ("LongGuns", "primary"),
            ("Pistols", "secondary"),
            ("Melee", "melee"),
        ):
            for e in inv.get(bin_key) or []:
                if isinstance(e, dict) and e.get("ItemType"):
                    owned["weapons"].append(
                        {
                            "uniqueName": e["ItemType"],
                            "slot": slot,
                            "xp": e.get("XP"),
                        }
                    )
        for e in inv.get("Suits") or []:
            if isinstance(e, dict) and e.get("ItemType"):
                owned["warframes"].append(
                    {"uniqueName": e["ItemType"], "xp": e.get("XP")}
                )
        (OUT / "owned.json").write_text(
            json.dumps(owned, ensure_ascii=False, indent=2)
        )
        print(
            f"owned: {len(owned['mods'])} mods, "
            f"{len(owned['weapons'])} weapons, {len(owned['warframes'])} frames"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
