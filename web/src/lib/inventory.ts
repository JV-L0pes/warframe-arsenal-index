import type { Catalog, OwnedSnapshot } from "@/lib/types";

/** Parse inventory.php-style raw dump into a compact owned snapshot. */
export function parseRawInventory(
  inv: Record<string, unknown>,
  account?: string,
): OwnedSnapshot {
  const mods = new Map<
    string,
    { uniqueName: string; rank: number | null; count: number }
  >();

  for (const key of ["RawUpgrades", "Upgrades"] as const) {
    const list = inv[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const uniqueName = e.ItemType;
      if (typeof uniqueName !== "string" || !uniqueName) continue;

      let rank: number | null = null;
      const fp = e.UpgradeFingerprint;
      if (typeof fp === "string") {
        try {
          const parsed = JSON.parse(fp) as { lvl?: number };
          if (typeof parsed.lvl === "number") rank = parsed.lvl;
        } catch {
          /* ignore */
        }
      } else if (fp && typeof fp === "object" && "lvl" in fp) {
        const lvl = (fp as { lvl?: number }).lvl;
        if (typeof lvl === "number") rank = lvl;
      }

      const count = Number(e.ItemCount ?? 1) || 1;
      const cur = mods.get(uniqueName) ?? {
        uniqueName,
        rank: null,
        count: 0,
      };
      cur.count += count;
      if (rank !== null && (cur.rank === null || rank > cur.rank)) {
        cur.rank = rank;
      }
      mods.set(uniqueName, cur);
    }
  }

  const weapons: OwnedSnapshot["weapons"] = [];
  for (const [bin, slot] of [
    ["LongGuns", "primary"],
    ["Pistols", "secondary"],
    ["Melee", "melee"],
  ] as const) {
    const list = inv[bin];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.ItemType !== "string") continue;
      weapons.push({
        uniqueName: e.ItemType,
        slot,
        xp: typeof e.XP === "number" ? e.XP : undefined,
      });
    }
  }

  const warframes: OwnedSnapshot["warframes"] = [];
  const suits = inv.Suits;
  if (Array.isArray(suits)) {
    for (const entry of suits) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.ItemType !== "string") continue;
      warframes.push({
        uniqueName: e.ItemType,
        xp: typeof e.XP === "number" ? e.XP : undefined,
      });
    }
  }

  return {
    account,
    mods: [...mods.values()],
    weapons,
    warframes,
  };
}

export function isOwnedSnapshot(value: unknown): value is OwnedSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as OwnedSnapshot;
  return (
    Array.isArray(v.mods) &&
    Array.isArray(v.weapons) &&
    Array.isArray(v.warframes)
  );
}

export function parseInventoryFile(
  data: unknown,
  account?: string,
): { ok: true; owned: OwnedSnapshot } | { ok: false; error: string } {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "JSON root must be an object." };
  }
  if (isOwnedSnapshot(data)) {
    return { ok: true, owned: data };
  }
  const inv = data as Record<string, unknown>;
  // inventory.php dumps always expose at least one of these
  const markers = ["RawUpgrades", "Upgrades", "Suits", "LongGuns", "XPInfo"];
  if (!markers.some((k) => k in inv)) {
    return {
      ok: false,
      error:
        "Unrecognized file. Expected inventory_raw.json (mobile API) or owned.json.",
    };
  }
  return { ok: true, owned: parseRawInventory(inv, account) };
}

export function buildCategorizedLists(
  catalog: Catalog,
  owned: OwnedSnapshot | null,
): Record<string, string[]> {
  const ownedMods = new Map(
    (owned?.mods ?? []).map((m) => [m.uniqueName, m] as const),
  );
  const lists: Record<string, string[]> = {};

  for (const mod of catalog.mods) {
    const o = ownedMods.get(mod.uniqueName);
    if (!o) continue;
    const key = `mods_${mod.category}`;
    if (!lists[key]) lists[key] = [];
    let label = mod.name;
    if (o.rank !== null) label += ` r${o.rank}`;
    if (o.count > 1) label += ` x${o.count}`;
    lists[key].push(label);
  }

  const ownedWeapons = new Set((owned?.weapons ?? []).map((w) => w.uniqueName));
  for (const w of catalog.weapons) {
    if (!ownedWeapons.has(w.uniqueName)) continue;
    const key = `${w.slot}_${w.subtype}`;
    if (!lists[key]) lists[key] = [];
    lists[key].push(w.name);
  }

  const ownedFrames = new Set(
    (owned?.warframes ?? []).map((f) => f.uniqueName),
  );
  lists.warframes = catalog.warframes
    .filter((f) => ownedFrames.has(f.uniqueName))
    .map((f) => f.name);

  for (const key of Object.keys(lists)) {
    lists[key].sort((a, b) => a.localeCompare(b));
  }
  return lists;
}

export const OWNED_STORAGE_KEY = "arsenal-index:owned";
