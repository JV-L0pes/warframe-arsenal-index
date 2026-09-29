import type { Catalog, OwnedSnapshot } from "@/lib/types";
import {
  isBaseMasteryDone,
  rankFromXp,
  xpForRank,
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
  const arcanes = new Map<
    string,
    { uniqueName: string; rank: number | null; count: number }
  >();

  // Disjoint copy pools: RawUpgrades = unranked stacks (ItemCount copies),
  // Upgrades = individual ranked/riven instances. Total copies = both summed.
  for (const key of ["RawUpgrades", "Upgrades"] as const) {
    const list = inv[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const uniqueName = e.ItemType;
      if (typeof uniqueName !== "string" || !uniqueName) continue;
      // Skip weapon/companion blueprints that sometimes land in upgrade bins
      if (
        uniqueName.includes("/Weapons/") ||
        uniqueName.includes("/Types/") ||
        uniqueName.includes("/Powersuits/")
      ) {
        continue;
      }

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
      const isArcane = uniqueName.includes("/CosmeticEnhancers/");
      const bucket = isArcane ? arcanes : mods;
      const cur = bucket.get(uniqueName) ?? {
        uniqueName,
        rank: null,
        count: 0,
      };
      cur.count += count;
      if (rank !== null && (cur.rank === null || rank > cur.rank)) {
        cur.rank = rank;
      }
      bucket.set(uniqueName, cur);
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

  const mastery: NonNullable<OwnedSnapshot["mastery"]> = [];
  const xpInfo = inv.XPInfo;
  if (Array.isArray(xpInfo)) {
    for (const entry of xpInfo) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.ItemType !== "string" || !e.ItemType) continue;
      if (typeof e.XP !== "number") continue;
      mastery.push({ uniqueName: e.ItemType, xp: e.XP });
    }
  }

  const resources: NonNullable<OwnedSnapshot["resources"]> = [];
  const miscItems = inv.MiscItems;
  if (Array.isArray(miscItems)) {
    for (const entry of miscItems) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.ItemType !== "string" || !e.ItemType) continue;
      const count = Number(e.ItemCount ?? 1) || 1;
      resources.push({ uniqueName: e.ItemType, count });
    }
  }

  return {
    account,
    syncedAt: meta?.syncedAt ?? new Date().toISOString(),
    source: meta?.source ?? "import",
    mods: [...mods.values()],
    weapons,
    warframes,
    arcanes: [...arcanes.values()],
    mastery,
    resources,
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

/** Affinity curve a uniqueName belongs to, for mastery thresholds. */
export function masteryKind(uniqueName: string): AffinityKind | null {
  if (uniqueName.includes("/Powersuits/")) return "warframe";
  if (uniqueName.includes("/Weapons/")) return "weapon";
  return null;
}

/** Rank-30 mastery done from lifetime XP (XPInfo) — works for sold items too. */
export function isMasteryDoneFromXp(uniqueName: string, xp: number): boolean {
  const kind = masteryKind(uniqueName);
  if (!kind) return false;
  return xp >= xpForRank(kind, 30);
}

/** Fill rank / masteryDone; migrate CosmeticEnhancers out of mods → arcanes. */
export function enrichOwnedSnapshot(owned: OwnedSnapshot): OwnedSnapshot {
  const masteryDoneByXp = new Set(
    (owned.mastery ?? [])
      .filter((m) => isMasteryDoneFromXp(m.uniqueName, m.xp))
      .map((m) => m.uniqueName),
  );
  const arcaneMap = new Map(
    (owned.arcanes ?? []).map((a) => [a.uniqueName, { ...a }] as const),
  );
  const mods: OwnedSnapshot["mods"] = [];
  for (const m of owned.mods) {
    if (m.uniqueName.includes("/CosmeticEnhancers/")) {
      const cur = arcaneMap.get(m.uniqueName);
      if (!cur) {
        arcaneMap.set(m.uniqueName, { ...m });
      } else {
        arcaneMap.set(m.uniqueName, {
          uniqueName: cur.uniqueName,
          count: Math.max(cur.count, m.count),
          rank:
            m.rank != null && (cur.rank == null || m.rank > cur.rank)
              ? m.rank
              : cur.rank,
        });
      }
      continue;
    }
    mods.push(m);
  }

  return {
    ...owned,
    mods,
    arcanes: [...arcaneMap.values()],
    weapons: owned.weapons.map((w) => {
      const polarized = w.polarized ?? 0;
      const rank = w.rank ?? rankFromXp("weapon", w.xp);
      return {
        ...w,
        polarized,
        rank,
        masteryDone:
          (w.masteryDone ?? isBaseMasteryDone({ polarized, rank })) ||
          masteryDoneByXp.has(w.uniqueName),
      };
    }),
    warframes: owned.warframes.map((f) => {
      const polarized = f.polarized ?? 0;
      const rank = f.rank ?? rankFromXp("warframe", f.xp);
      return {
        ...f,
        polarized,
        rank,
        masteryDone:
          (f.masteryDone ?? isBaseMasteryDone({ polarized, rank })) ||
          masteryDoneByXp.has(f.uniqueName),
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

export type ExportScope =
  | "all"
  | "mods"
  | "weapons"
  | "warframes"
  | "arcanes"
  | "resources";
export type ExportScopeSelection = ExportScope | ExportScope[];

const ALL_SECTIONS: ExportScope[] = [
  "mods",
  "weapons",
  "warframes",
  "arcanes",
  "resources",
];

function scopesOf(scope: ExportScopeSelection): Set<ExportScope> {
  const list =
    scope === "all" ? ALL_SECTIONS : Array.isArray(scope) ? scope : [scope];
  return new Set(list);
}

/** Filename slug: "all", one section, or combined ("mods-weapons") in canonical order. */
export function exportScopeSlug(scope: ExportScopeSelection): string {
  const scopes = scopesOf(scope);
  if (scopes.size === ALL_SECTIONS.length) return "all";
  return ALL_SECTIONS.filter((s) => scopes.has(s)).join("-");
}

export function buildCategorizedLists(
  catalog: Catalog,
  owned: OwnedSnapshot | null,
  scope: ExportScopeSelection = "all",
): ExportPayload {
  const scopes = scopesOf(scope);
  const ownedMods = new Map(
    (owned?.mods ?? []).map((m) => [m.uniqueName, m] as const),
  );
  const lists: ExportPayload = {};

  if (scopes.has("mods")) {
    for (const mod of catalog.mods) {
      const o = ownedMods.get(mod.uniqueName);
      if (!o) continue;
      const key = `mods_${mod.category}`;
      if (!lists[key]) lists[key] = [] as string[];
      (lists[key] as string[]).push(mod.name);
    }
  }

  if (scopes.has("arcanes")) {
    const ownedArcanes = new Map(
      (owned?.arcanes ?? []).map((a) => [a.uniqueName, a] as const),
    );
    const names: string[] = [];
    for (const a of catalog.arcanes ?? []) {
      if (!ownedArcanes.has(a.uniqueName)) continue;
      names.push(a.name);
    }
    if (names.length) {
      lists.arcanes = names.sort((a, b) => a.localeCompare(b));
    }
  }

  if (scopes.has("weapons")) {
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
  }

  if (scopes.has("warframes")) {
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
    if (frames.length) lists.warframes = frames;
  }

  if (scopes.has("resources")) {
    const ownedResources = new Map(
      (owned?.resources ?? []).map((r) => [r.uniqueName, r] as const),
    );
    const entries: ExportEntry[] = [];
    for (const r of catalog.resources ?? []) {
      const o = ownedResources.get(r.uniqueName);
      if (!o) continue;
      entries.push({ name: r.name, count: o.count });
    }
    if (entries.length) lists.resources = entries;
  }

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

export type InventoryRow = (string | number)[];

/** Flat inventory rows shared by the CSV and XLSX exports. */
export function buildInventoryRows(
  catalog: Catalog,
  owned: OwnedSnapshot | null,
  scope: ExportScopeSelection = "all",
): InventoryRow[] {
  const scopes = scopesOf(scope);
  const rows: InventoryRow[] = [
    ["type", "name", "group", "subtype", "rank", "count", "polarized", "mastery"],
  ];
  const rank = (r: number | null | undefined) => r ?? "";

  if (scopes.has("mods")) {
    const ownedMods = new Map(
      (owned?.mods ?? []).map((m) => [m.uniqueName, m] as const),
    );
    for (const mod of catalog.mods) {
      const o = ownedMods.get(mod.uniqueName);
      if (!o) continue;
      rows.push([
        "mod",
        mod.name,
        String(mod.category ?? ""),
        "",
        rank(o.rank),
        o.count ?? 1,
        "",
        "",
      ]);
    }
  }

  if (scopes.has("arcanes")) {
    const ownedArcanes = new Map(
      (owned?.arcanes ?? []).map((a) => [a.uniqueName, a] as const),
    );
    for (const a of catalog.arcanes ?? []) {
      const o = ownedArcanes.get(a.uniqueName);
      if (!o) continue;
      rows.push([
        "arcane",
        a.name,
        "arcane",
        "",
        rank(o.rank),
        o.count ?? 1,
        "",
        "",
      ]);
    }
  }

  if (scopes.has("weapons")) {
    const ownedWeapons = new Map(
      (owned?.weapons ?? []).map((w) => [w.uniqueName, w] as const),
    );
    for (const w of catalog.weapons) {
      const o = ownedWeapons.get(w.uniqueName);
      if (!o) continue;
      rows.push([
        "weapon",
        w.name,
        w.slot,
        w.subtype,
        rank(o.rank),
        "",
        o.polarized ?? 0,
        o.masteryDone ? "done" : "open",
      ]);
    }
  }

  if (scopes.has("warframes")) {
    const ownedFrames = new Map(
      (owned?.warframes ?? []).map((f) => [f.uniqueName, f] as const),
    );
    for (const f of catalog.warframes) {
      const o = ownedFrames.get(f.uniqueName);
      if (!o) continue;
      rows.push([
        "warframe",
        f.name,
        "",
        "",
        rank(o.rank),
        "",
        o.polarized ?? 0,
        o.masteryDone ? "done" : "open",
      ]);
    }
  }

  if (scopes.has("resources")) {
    const ownedResources = new Map(
      (owned?.resources ?? []).map((r) => [r.uniqueName, r] as const),
    );
    for (const r of catalog.resources ?? []) {
      const o = ownedResources.get(r.uniqueName);
      if (!o) continue;
      rows.push(["resource", r.name, "", "", "", o.count, "", ""]);
    }
  }

  return rows;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Spreadsheet-ready CSV (BOM + CRLF for Excel). */
export function buildCsv(
  catalog: Catalog,
  owned: OwnedSnapshot | null,
  scope: ExportScopeSelection = "all",
): string {
  const body = buildInventoryRows(catalog, owned, scope)
    .map((row) => row.map((v) => csvField(String(v))).join(","))
    .join("\r\n");
  return `\uFEFF${body}\r\n`;
}

