#!/usr/bin/env python3
"""Build web/public/data/catalog.json (+ optional owned.json) from Public Export cache."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "data" / "cache"
OUT = ROOT.parent / "web" / "public" / "data"
INV = ROOT / "data" / "inventory_raw.json"

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
    for key in (u.get("compatName"), u.get("type")):
        if not key:
            continue
        if key in MOD_MAP:
            return MOD_MAP[key]
        up = str(key).upper()
        for k, v in MOD_MAP.items():
            if k.upper() == up or k.upper() in up:
                return v
    path = u.get("uniqueName", "")
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


def is_augment(u: dict) -> bool:
    t = str(u.get("type") or "").upper()
    if t in {"STANCE", "AURA", "WARFRAME", "PRIMARY", "SECONDARY", "MELEE"}:
        # still allow frame-specific augments (compatName is a frame name)
        pass
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


def should_skip_mod(un: str) -> bool:
    if "Riven" in un or "RandomMod" in un:
        return True
    if "/PvPMods/" in un or "/PvP/" in un:
        return True
    if "/Beginner/" in un or "/Expert/" in un:
        return True
    return False


def main() -> int:
    if not (CACHE / "ExportUpgrades_en.json").exists():
        print("missing cache — run: python3 categorize.py", file=sys.stderr)
        return 1

    ups = json.loads((CACHE / "ExportUpgrades_en.json").read_text())["ExportUpgrades"]
    mods = []
    for u in ups:
        un = u.get("uniqueName", "")
        if should_skip_mod(un):
            continue
        mods.append(
            {
                "uniqueName": un,
                "name": clean(u.get("name")),
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
        blob = f"{name} {w.get('uniqueName', '')}"
        sub = "other"
        if slot == "primary":
            if re.search(
                r"Shotgun|Hek|Tigris|Strun|Boar|Corinth|Cedo|Drakgoon|FlakCannon|Convectrix",
                blob,
                re.I,
            ):
                sub = "shotgun"
            elif re.search(r"Sniper|Vectis|Rubico|Lanka|Vulkar", blob, re.I):
                sub = "sniper"
            elif re.search(r"/Bows?/|Nataruk|Paris|Cernos|Dread|Lenz", blob, re.I):
                sub = "bow"
            else:
                sub = "rifle"
        elif slot == "secondary":
            sub = (
                "shotgun"
                if re.search(r"HandShotGun|Bronco|Pyrana", blob, re.I)
                else "pistol"
            )
        elif slot == "melee":
            sub = "melee"
        wout.append(
            {
                "uniqueName": w["uniqueName"],
                "name": name,
                "slot": slot,
                "subtype": sub,
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
        "generatedFrom": "Warframe Public Export",
        "generatedAt": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "filters": [
            "skip Riven/RandomMod",
            "skip PvPMods",
            "skip Beginner/Expert variants",
        ],
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

    if INV.exists():
        inv = json.loads(INV.read_text())
        owned: dict = {
            "mods": {},
            "weapons": [],
            "warframes": [],
            "account": "B4uklotze",
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
