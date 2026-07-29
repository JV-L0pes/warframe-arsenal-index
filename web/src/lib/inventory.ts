import type { Catalog, OwnedSnapshot } from "@/lib/types";
import {
  isBaseMasteryDone,
  rankFromXp,
  type AffinityKind,
} from "@/lib/affinity";

function readPolarized(e: Record<string, unknown>): number {
  const p = e.Polarized;
  if (typeof p === "number" && p > 0) return p;
  return 0;
}

function equipmentProgress(
  e: Record<string, unknown>,
  kind: AffinityKind,
): { xp?: number; rank: number; polarized: number; masteryDone: boolean } {
  const xp = typeof e.XP === "number" ? e.XP : undefined;
  const polarized = readPolarized(e);
  const rank = rankFromXp(kind, xp);
  return {
    xp,
    rank,
    polarized,
    masteryDone: isBaseMasteryDone({ polarized, rank }),
  };
}

/** Parse inventory.php-style raw dump into a compact owned snapshot. */
export function parseRawInventory(
  inv: Record<string, unknown>,
  account?: string,
  meta?: { syncedAt?: string; source?: string },
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
      const prog = equipmentProgress(e, "weapon");
      weapons.push({
        uniqueName: e.ItemType,
        slot,
        ...prog,
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
      const prog = equipmentProgress(e, "warframe");
      warframes.push({
        uniqueName: e.ItemType,
        ...prog,
      });
    }
  }

  return {
    account,
    syncedAt: meta?.syncedAt ?? new Date().toISOString(),
    source: meta?.source ?? "import",
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

/** Fill rank / masteryDone from xp + polarized when missing (older snapshots). */
export function enrichOwnedSnapshot(owned: OwnedSnapshot): OwnedSnapshot {
  return {
    ...owned,
    weapons: owned.weapons.map((w) => {
      const polarized = w.polarized ?? 0;
      const rank = w.rank ?? rankFromXp("weapon", w.xp);
      return {
        ...w,
        polarized,
        rank,
        masteryDone: w.masteryDone ?? isBaseMasteryDone({ polarized, rank }),
      };
    }),
    warframes: owned.warframes.map((f) => {
      const polarized = f.polarized ?? 0;
      const rank = f.rank ?? rankFromXp("warframe", f.xp);
      return {
        ...f,
        polarized,
        rank,
        masteryDone: f.masteryDone ?? isBaseMasteryDone({ polarized, rank }),
      };
    }),
  };
}

export function parseInventoryFile(
  data: unknown,
  account?: string,
  meta?: { syncedAt?: string; source?: string },
): { ok: true; owned: OwnedSnapshot } | { ok: false; error: string } {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "JSON root must be an object." };
  }
  if (isOwnedSnapshot(data)) {
    const owned = data as OwnedSnapshot;
    return {
      ok: true,
      owned: enrichOwnedSnapshot({
        ...owned,
        syncedAt: owned.syncedAt ?? meta?.syncedAt,
        source: owned.source ?? meta?.source ?? "import",
      }),
    };
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
  return {
    ok: true,
    owned: parseRawInventory(inv, account, {
      syncedAt: meta?.syncedAt ?? new Date().toISOString(),
      source: meta?.source ?? "mobile-api",
    }),
  };
}

/** Days after which inventory is considered stale. */
export const STALE_AFTER_DAYS = 7;

export function inventoryAgeMs(owned: OwnedSnapshot | null): number | null {
  if (!owned?.syncedAt) return null;
  const t = Date.parse(owned.syncedAt);
  if (Number.isNaN(t)) return null;
  return Date.now() - t;
}

export function isInventoryStale(owned: OwnedSnapshot | null): boolean {
  const age = inventoryAgeMs(owned);
  if (age === null) return Boolean(owned); // present but unknown age → treat cautiously
  return age > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

export function formatSyncedAt(owned: OwnedSnapshot | null): string {
  if (!owned?.syncedAt) return owned ? "sync time unknown" : "no inventory";
  const t = Date.parse(owned.syncedAt);
  if (Number.isNaN(t)) return "sync time unknown";
  const age = Date.now() - t;
  const mins = Math.floor(age / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const DISCLAIMER_KEY = "arsenal-index:disclaimer-accepted";
export const OWNED_STORAGE_KEY = "arsenal-index:owned";

export type ExportEntry = {
  name: string;
  rank?: number | null;
  count?: number;
  /** Forma count */
  polarized?: number;
  /** Base MR (ranks 1–30) already claimed */
  masteryDone?: boolean;
  /** Human label: "mastery done" | "MR open" */
  mastery?: "done" | "open";
};

/** Mods are plain names; weapons/warframes keep status objects. */
export type ExportPayload = Record<string, string[] | ExportEntry[]>;

export function buildCategorizedLists(
  catalog: Catalog,
  owned: OwnedSnapshot | null,
): ExportPayload {
  const ownedMods = new Map(
    (owned?.mods ?? []).map((m) => [m.uniqueName, m] as const),
  );
  const lists: ExportPayload = {};

  for (const mod of catalog.mods) {
    const o = ownedMods.get(mod.uniqueName);
    if (!o) continue;
    const key = `mods_${mod.category}`;
    if (!lists[key]) lists[key] = [] as string[];
    (lists[key] as string[]).push(mod.name);
  }

  const ownedWeapons = new Map(
    (owned?.weapons ?? []).map((w) => [w.uniqueName, w] as const),
  );
  for (const w of catalog.weapons) {
    const o = ownedWeapons.get(w.uniqueName);
    if (!o) continue;
    const key = `${w.slot}_${w.subtype}`;
    if (!lists[key]) lists[key] = [] as ExportEntry[];
    const masteryDone = Boolean(o.masteryDone);
    (lists[key] as ExportEntry[]).push({
      name: w.name,
      rank: o.rank ?? null,
      polarized: o.polarized ?? 0,
      masteryDone,
      mastery: masteryDone ? "done" : "open",
    });
  }

  const ownedFrames = new Map(
    (owned?.warframes ?? []).map((f) => [f.uniqueName, f] as const),
  );
  const frames: ExportEntry[] = [];
  for (const f of catalog.warframes) {
    const o = ownedFrames.get(f.uniqueName);
    if (!o) continue;
    const masteryDone = Boolean(o.masteryDone);
    frames.push({
      name: f.name,
      rank: o.rank ?? null,
      polarized: o.polarized ?? 0,
      masteryDone,
      mastery: masteryDone ? "done" : "open",
    });
  }
  lists.warframes = frames;

  for (const key of Object.keys(lists)) {
    const list = lists[key];
    if (list.length && typeof list[0] === "string") {
      (list as string[]).sort((a, b) => a.localeCompare(b));
    } else {
      (list as ExportEntry[]).sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  return lists;
}

