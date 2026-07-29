#!/usr/bin/env python3
"""Turn raw Warframe inventory.json into categorized lists.

Uses DE Public Export (mods + weapons) for names/types when available,
with path heuristics as fallback.

Example output shape:

{
  "account": "B4uklotze",
  "mods": {
    "rifle": [{"name": "Serration", "rank": 10, "count": 1}],
    "shotgun": [...],
    "pistol": [...],
    "melee": [...],
    "warframe": [...],
    ...
  },
  "weapons": {
    "primary": {"rifle": [...], "shotgun": [...], "bow": [...], ...},
    "secondary": {...},
    "melee": {...}
  },
  "warframes": [...],
  ...
}
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

MANIFEST_INDEX = "https://content.warframe.com/PublicExport/index_en.txt.lzma"
CACHE_DIR = Path("data/cache")

# inventory.php item lists (not *Bin slot counters)
INV_ITEM_LISTS = {
    "Suits",
    "LongGuns",
    "Pistols",
    "Melee",
    "SpaceSuits",
    "SpaceGuns",
    "SpaceMelee",
    "Sentinels",
    "SentinelWeapons",
    "Horses",
    "MoaPets",
    "KubrowPets",
    "Upgrades",
    "RawUpgrades",
    "OperatorAmps",
    "MechBin",  # sometimes list; sometimes not
}

# Public Export mod type / compatName → our keys
MOD_BUCKETS = {
    "RIFLE": "rifle",
    "ASSAULT RIFLE": "rifle",
    "SHOTGUN": "shotgun",
    "SNIPER": "sniper",
    "BOW": "bow",
    "PISTOL": "pistol",
    "SECONDARY": "pistol",
    "MELEE": "melee",
    "WARFRAME": "warframe",
    "AURA": "aura",
    "STANCE": "stance",
    "ARCHWING": "archwing",
    "ARCHGUN": "archgun",
    "ARCHMELEE": "archmelee",
    "ROBOTIC": "robotic",
    "KUBROW": "beast",
    "KAVAT": "beast",
    "BEAST": "beast",
    "MOA": "beast",
    "HELMINTH": "helminth",
    "PARAZON": "parazon",
    "PRIMARY": "primary_generic",
    "RAILJACK": "railjack",
    "NECROMECH": "necromech",
    "AMP": "amp",
    "KITGUN": "kitgun",
    "ZAW": "zaw",
}

PATH_MOD_HINTS = [
    (re.compile(r"/Mods/(?:Weapon/)?(?:Rifle|AssaultRifle)/", re.I), "rifle"),
    (re.compile(r"/Mods/(?:Weapon/)?Shotgun/", re.I), "shotgun"),
    (re.compile(r"/Mods/(?:Weapon/)?Sniper/", re.I), "sniper"),
    (re.compile(r"/Mods/(?:Weapon/)?Bow/", re.I), "bow"),
    (re.compile(r"/Mods/(?:Weapon/)?(?:Pistol|HandGun|Secondary)/", re.I), "pistol"),
    (re.compile(r"/Mods/(?:Weapon/)?Melee/", re.I), "melee"),
    (re.compile(r"/Mods/Warframe/", re.I), "warframe"),
    (re.compile(r"/Mods/Aura/", re.I), "aura"),
    (re.compile(r"/Mods/Stance/", re.I), "stance"),
    (re.compile(r"/Mods/Archwing/", re.I), "archwing"),
    (re.compile(r"/Mods/Archgun/", re.I), "archgun"),
    (re.compile(r"/Mods/Sentinel/", re.I), "robotic"),
    (re.compile(r"/Mods/(?:Kubrow|Kavat|Beast|Moa)/", re.I), "beast"),
    (re.compile(r"/Mods/Railjack/", re.I), "railjack"),
    (re.compile(r"/Mods/Necramech/", re.I), "necromech"),
    (re.compile(r"DataSpike|Parazon", re.I), "parazon"),
]

PATH_WEAPON_HINTS = [
    (
        re.compile(
            r"Shotgun|Hek|Tigris|Strun|Boar|Corinth|Cedo|Bubonico|FlakCannon|Drakgoon|"
            r"Convectrix|SplitLaser|Sobek|Phantasma|Astrolabe",
            re.I,
        ),
        "shotgun",
    ),
    (re.compile(r"Sniper|Vectis|Rubico|Snipetron|Lanka|Vulkar|Sporothrix", re.I), "sniper"),
    (
        re.compile(
            r"(?:^|/)Bows?/|/Omicrus/|Paris|Dread|Cernos|Nataruk|Nagantaka|Lenz|Daikyu|Zhuge|Attica|Ballistica",
            re.I,
        ),
        "bow",
    ),
    (re.compile(r"Spear|Javlok|Scourge|Ferrox|Afentis", re.I), "speargun"),
    (re.compile(r"Launcher|Ogris|Torid|Penta|Zarr|Tonkor|Kuva\s*Bramma", re.I), "launcher"),
]


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "warframe-inventory-export/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def load_manifest_urls() -> dict[str, str]:
    """Map Export*.json basename → full download URL with hash."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / "index_en.txt"
    if not cache.exists():
        # index is lzma-compressed plain text of relative paths
        import lzma

        raw = http_get(MANIFEST_INDEX)
        text = lzma.decompress(raw).decode("utf-8", errors="replace")
        cache.write_text(text)
    else:
        text = cache.read_text()

    urls: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or "!" not in line:
            continue
        # e.g. ExportUpgrades_en.json!hash
        name = line.split("!", 1)[0]
        urls[name] = f"https://content.warframe.com/PublicExport/Manifest/{line}"
    return urls


def load_json_export(basename: str) -> Any:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    local = CACHE_DIR / basename
    if local.exists():
        return json.loads(local.read_text(encoding="utf-8"))
    urls = load_manifest_urls()
    # basename might be ExportUpgrades_en.json
    url = urls.get(basename)
    if not url:
        # try fuzzy
        for k, v in urls.items():
            if k.startswith(basename.replace(".json", "")):
                url = v
                break
    if not url:
        raise RuntimeError(f"manifest entry not found for {basename}")
    raw = http_get(url)
    # Public Export JSON often has a leading BOM / weird wrapper — try loads
    text = raw.decode("utf-8-sig", errors="replace")
    data = json.loads(text)
    local.write_text(json.dumps(data), encoding="utf-8")
    return data


def build_mod_index() -> dict[str, dict[str, Any]]:
    data = load_json_export("ExportUpgrades_en.json")
    upgrades = data.get("ExportUpgrades") or data
    index: dict[str, dict[str, Any]] = {}
    if isinstance(upgrades, list):
        for u in upgrades:
            un = u.get("uniqueName")
            if un:
                index[un] = u
    return index


def build_weapon_index() -> dict[str, dict[str, Any]]:
    data = load_json_export("ExportWeapons_en.json")
    weapons = data.get("ExportWeapons") or data
    index: dict[str, dict[str, Any]] = {}
    if isinstance(weapons, list):
        for w in weapons:
            un = w.get("uniqueName")
            if un:
                index[un] = w
    return index


def build_warframe_index() -> dict[str, dict[str, Any]]:
    data = load_json_export("ExportWarframes_en.json")
    frames = data.get("ExportWarframes") or data
    index: dict[str, dict[str, Any]] = {}
    if isinstance(frames, list):
        for f in frames:
            un = f.get("uniqueName")
            if un:
                index[un] = f
    return index


def clean_name(name: str | None, fallback: str) -> str:
    if not name:
        return fallback.rsplit("/", 1)[-1]
    # DE names often have |NAME| localization markup
    name = re.sub(r"\|[^|]*\|", "", name)
    return name.strip() or fallback.rsplit("/", 1)[-1]


def mod_bucket(item_type: str, meta: dict[str, Any] | None) -> str:
    if meta:
        for key in (meta.get("compatName"), meta.get("type")):
            if not key:
                continue
            bucket = MOD_BUCKETS.get(str(key).upper())
            if bucket:
                return bucket
            # partial
            up = str(key).upper()
            for needle, b in MOD_BUCKETS.items():
                if needle in up:
                    return b
    for rx, b in PATH_MOD_HINTS:
        if rx.search(item_type):
            return b
    return "other"


def weapon_subtype(item_type: str, meta: dict[str, Any] | None) -> str:
    pc = str((meta or {}).get("productCategory") or "")
    name = clean_name((meta or {}).get("name"), item_type)
    blob = f"{name} {item_type}"

    # Slot first — avoids Bolto (path …/Pistol/CrossBow) becoming "bow"
    if pc == "Pistols" or "/Pistol" in item_type or "/Pistols/" in item_type:
        if re.search(r"HandShotGun|Shotgun|Bronco|Pyrana|Kohmak|Detron", blob, re.I):
            return "shotgun"
        return "pistol"
    if pc == "Melee" or "/Melee/" in item_type:
        t = str((meta or {}).get("type") or "melee").lower().replace(" ", "_")
        return t or "melee"

    for rx, b in PATH_WEAPON_HINTS:
        if rx.search(blob):
            return b
    if pc == "LongGuns":
        return "rifle"
    return "rifle"


def parse_rank(entry: dict[str, Any]) -> int | None:
    fp = entry.get("UpgradeFingerprint")
    if not fp:
        return None
    if isinstance(fp, dict):
        lvl = fp.get("lvl")
        return int(lvl) if lvl is not None else None
    if isinstance(fp, str):
        try:
            obj = json.loads(fp)
            if isinstance(obj, dict) and "lvl" in obj:
                return int(obj["lvl"])
        except json.JSONDecodeError:
            m = re.search(r'"lvl"\s*:\s*(\d+)', fp)
            if m:
                return int(m.group(1))
    return None


def item_level(entry: dict[str, Any]) -> int | None:
    # XPProgress often present; Level sometimes
    for k in ("Level", "ItemLevel", "XPLevel"):
        if k in entry:
            try:
                return int(entry[k])
            except (TypeError, ValueError):
                pass
    return None


def categorize(
    inv: dict[str, Any],
    account: str | None = None,
    mod_index: dict[str, dict[str, Any]] | None = None,
    weapon_index: dict[str, dict[str, Any]] | None = None,
    warframe_index: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    mod_index = mod_index or {}
    weapon_index = weapon_index or {}
    warframe_index = warframe_index or {}

    out: dict[str, Any] = {
        "account": account,
        "mods": defaultdict(list),
        "weapons": {
            "primary": defaultdict(list),
            "secondary": defaultdict(list),
            "melee": defaultdict(list),
        },
        "warframes": [],
        "archwing": [],
        "companions": {
            "sentinels": [],
            "sentinel_weapons": [],
            "kubrow": [],
            "moa": [],
        },
        "other_bins": {},
    }

    # --- mods (RawUpgrades = stacks; Upgrades = ranked copies) ---
    mods_acc: dict[str, dict[str, Any]] = {}
    for key in ("RawUpgrades", "Upgrades"):
        for entry in inv.get(key) or []:
            if not isinstance(entry, dict):
                continue
            item_type = entry.get("ItemType") or ""
            if not item_type:
                continue
            meta = mod_index.get(item_type)
            name = clean_name(meta.get("name") if meta else None, item_type)
            bucket = mod_bucket(item_type, meta)
            rank = parse_rank(entry)
            count = entry.get("ItemCount", 1)
            try:
                count = int(count)
            except (TypeError, ValueError):
                count = 1
            cur = mods_acc.get(item_type)
            if cur is None:
                rec = {
                    "name": name,
                    "uniqueName": item_type,
                    "rank": rank,
                    "count": count,
                    "_bucket": bucket,
                }
                if meta:
                    rec["polarity"] = meta.get("polarity")
                    rec["rarity"] = meta.get("rarity")
                    rec["compatName"] = meta.get("compatName")
                    rec["type"] = meta.get("type")
                mods_acc[item_type] = rec
            else:
                cur["count"] += count
                if rank is not None and (cur.get("rank") is None or rank > cur["rank"]):
                    cur["rank"] = rank

    for rec in mods_acc.values():
        bucket = rec.pop("_bucket")
        out["mods"][bucket].append(rec)

    # --- equipment bins ---
    def iter_item_dicts(bin_key: str):
        data = inv.get(bin_key)
        if not isinstance(data, list):
            return
        for entry in data:
            if isinstance(entry, dict) and entry.get("ItemType"):
                yield entry

    def add_equipment(bin_key: str, dest_list: list, index: dict[str, dict[str, Any]]):
        for entry in iter_item_dicts(bin_key):
            item_type = entry.get("ItemType") or ""
            meta = index.get(item_type)
            dest_list.append(
                {
                    "name": clean_name(meta.get("name") if meta else None, item_type),
                    "uniqueName": item_type,
                    "level": item_level(entry),
                    "xp": entry.get("XP"),
                    "count": entry.get("ItemCount", 1),
                }
            )

    add_equipment("Suits", out["warframes"], warframe_index)
    add_equipment("SpaceSuits", out["archwing"], warframe_index)

    for entry in iter_item_dicts("LongGuns"):
        item_type = entry.get("ItemType") or ""
        meta = weapon_index.get(item_type)
        sub = weapon_subtype(item_type, meta)
        out["weapons"]["primary"][sub].append(
            {
                "name": clean_name(meta.get("name") if meta else None, item_type),
                "uniqueName": item_type,
                "level": item_level(entry),
                "xp": entry.get("XP"),
                "count": entry.get("ItemCount", 1),
            }
        )

    for entry in iter_item_dicts("Pistols"):
        item_type = entry.get("ItemType") or ""
        meta = weapon_index.get(item_type)
        sub = weapon_subtype(item_type, meta)
        out["weapons"]["secondary"][sub].append(
            {
                "name": clean_name(meta.get("name") if meta else None, item_type),
                "uniqueName": item_type,
                "level": item_level(entry),
                "xp": entry.get("XP"),
                "count": entry.get("ItemCount", 1),
            }
        )

    for entry in iter_item_dicts("Melee"):
        item_type = entry.get("ItemType") or ""
        meta = weapon_index.get(item_type)
        sub = weapon_subtype(item_type, meta)
        out["weapons"]["melee"][sub].append(
            {
                "name": clean_name(meta.get("name") if meta else None, item_type),
                "uniqueName": item_type,
                "level": item_level(entry),
                "xp": entry.get("XP"),
                "count": entry.get("ItemCount", 1),
            }
        )

    add_equipment("Sentinels", out["companions"]["sentinels"], warframe_index)
    add_equipment("SentinelWeapons", out["companions"]["sentinel_weapons"], weapon_index)
    add_equipment("KubrowPets", out["companions"]["kubrow"], warframe_index)
    add_equipment("MoaPets", out["companions"]["moa"], warframe_index)

    # leftover interesting bins (raw counts)
    for k, v in inv.items():
        if k in INV_ITEM_LISTS:
            continue
        if isinstance(v, list) and v and isinstance(v[0], dict) and "ItemType" in v[0]:
            out["other_bins"][k] = len(v)

    # sort names
    for bucket, items in out["mods"].items():
        items.sort(key=lambda x: (x["name"].lower(), x.get("rank") or 0))
    out["mods"] = dict(sorted(out["mods"].items(), key=lambda kv: kv[0]))

    for slot in out["weapons"]:
        for sub, items in out["weapons"][slot].items():
            items.sort(key=lambda x: x["name"].lower())
        out["weapons"][slot] = dict(sorted(out["weapons"][slot].items(), key=lambda kv: kv[0]))

    out["warframes"].sort(key=lambda x: x["name"].lower())

    # human-readable flat lists (what you asked for)
    def fmt_mod(i: dict[str, Any]) -> str:
        s = i["name"]
        if i.get("rank") is not None:
            s += f" r{i['rank']}"
        if (i.get("count") or 1) > 1:
            s += f" x{i['count']}"
        return s

    out["lists"] = {
        f"mods_{k}": [fmt_mod(i) for i in v]
        for k, v in out["mods"].items()
    }
    out["lists"]["warframes"] = [i["name"] for i in out["warframes"]]
    for slot, subs in out["weapons"].items():
        for sub, items in subs.items():
            out["lists"][f"{slot}_{sub}"] = [i["name"] for i in items]

    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Categorize Warframe inventory JSON")
    ap.add_argument(
        "-i",
        "--input",
        type=Path,
        default=Path("data/inventory_raw.json"),
    )
    ap.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("data/inventory_categorized.json"),
    )
    ap.add_argument("--account", default="B4uklotze")
    ap.add_argument("--no-export-db", action="store_true", help="skip Public Export download")
    ap.add_argument("--lists-only", action="store_true", help="write only the flat lists object")
    args = ap.parse_args()

    if not args.input.exists():
        print(f"error: missing {args.input} — run fetch_inventory.py first", file=sys.stderr)
        return 1

    inv = json.loads(args.input.read_text(encoding="utf-8"))

    mod_index = weapon_index = warframe_index = {}
    if not args.no_export_db:
        print("loading Public Export catalogs…", file=sys.stderr)
        try:
            mod_index = build_mod_index()
            print(f"  mods: {len(mod_index)}", file=sys.stderr)
        except Exception as e:
            print(f"  warn mods catalog: {e}", file=sys.stderr)
        try:
            weapon_index = build_weapon_index()
            print(f"  weapons: {len(weapon_index)}", file=sys.stderr)
        except Exception as e:
            print(f"  warn weapons catalog: {e}", file=sys.stderr)
        try:
            warframe_index = build_warframe_index()
            print(f"  warframes: {len(warframe_index)}", file=sys.stderr)
        except Exception as e:
            print(f"  warn warframes catalog: {e}", file=sys.stderr)

    result = categorize(
        inv,
        account=args.account,
        mod_index=mod_index,
        weapon_index=weapon_index,
        warframe_index=warframe_index,
    )
    payload = result["lists"] if args.lists_only else result

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.output}", file=sys.stderr)

    # short summary
    lists = result["lists"]
    for key in sorted(lists):
        print(f"  {key}: {len(lists[key])}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        raise SystemExit(1)
