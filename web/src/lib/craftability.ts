import type { Catalog, OwnedSnapshot } from "@/lib/types";

export type BuildPart = {
  uniqueName: string;
  name: string;
  kind: "mod" | "arcane";
  /** Rank required by the build (if known). */
  rank?: number | null;
};

export type MissingPart = BuildPart & {
  reason: "absent" | "low_rank";
  ownedRank: number | null;
};

export type Craftability = {
  total: number;
  owned: number;
  missing: MissingPart[];
  underleveled: MissingPart[];
  ownedParts: BuildPart[];
  /** 0–100 — only parts you fully meet (presence + rank). */
  pct: number;
  itemOwned: boolean | null;
};

/** Collect mods + arcanes from an Arsenyx buildData blob. */
export function extractArsenyxParts(buildData: unknown): BuildPart[] {
  if (!buildData || typeof buildData !== "object") return [];
  const data = buildData as Record<string, unknown>;
  const parts: BuildPart[] = [];
  const seen = new Set<string>();

  const slots = data.slots;
  if (slots && typeof slots === "object") {
    for (const slot of Object.values(slots as Record<string, unknown>)) {
      if (!slot || typeof slot !== "object") continue;
      const s = slot as Record<string, unknown>;
      const mod = s.mod;
      if (!mod || typeof mod !== "object") continue;
      const m = mod as Record<string, unknown>;
      const uniqueName = typeof m.uniqueName === "string" ? m.uniqueName : "";
      const name = typeof m.name === "string" ? m.name : uniqueName;
      if (!uniqueName || seen.has(uniqueName)) continue;
      seen.add(uniqueName);
      parts.push({
        uniqueName,
        name,
        kind: "mod",
        rank: typeof s.rank === "number" ? s.rank : null,
      });
    }
  }

  const arcanes = data.arcanes;
  if (Array.isArray(arcanes)) {
    for (const entry of arcanes) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const arc = e.arcane;
      if (!arc || typeof arc !== "object") continue;
      const a = arc as Record<string, unknown>;
      const uniqueName = typeof a.uniqueName === "string" ? a.uniqueName : "";
      const name = typeof a.name === "string" ? a.name : uniqueName;
      if (!uniqueName || seen.has(uniqueName)) continue;
      seen.add(uniqueName);
      parts.push({
        uniqueName,
        name,
        kind: "arcane",
        rank: typeof e.rank === "number" ? e.rank : null,
      });
    }
  }

  return parts;
}

export function ownedRankMap(
  owned: OwnedSnapshot | null,
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  if (!owned) return map;
  for (const m of owned.mods) map.set(m.uniqueName, m.rank);
  for (const a of owned.arcanes ?? []) map.set(a.uniqueName, a.rank);
  return map;
}

function meetsRank(
  ownedRank: number | null | undefined,
  required: number | null | undefined,
): boolean {
  if (required == null || required <= 0) return true;
  if (ownedRank == null) return false;
  return ownedRank >= required;
}

export function scoreCraftability(
  parts: BuildPart[],
  owned: OwnedSnapshot | null,
  itemUniqueName?: string | null,
): Craftability {
  const ranks = ownedRankMap(owned);
  const ownedParts: BuildPart[] = [];
  const missing: MissingPart[] = [];
  const underleveled: MissingPart[] = [];

  for (const p of parts) {
    if (!ranks.has(p.uniqueName)) {
      missing.push({
        ...p,
        reason: "absent",
        ownedRank: null,
      });
      continue;
    }
    const ownedRank = ranks.get(p.uniqueName) ?? null;
    if (!meetsRank(ownedRank, p.rank)) {
      const row: MissingPart = {
        ...p,
        reason: "low_rank",
        ownedRank,
      };
      missing.push(row);
      underleveled.push(row);
      continue;
    }
    ownedParts.push(p);
  }

  const total = parts.length;
  const ownedN = ownedParts.length;
  const pct = total === 0 ? 100 : Math.round((ownedN / total) * 100);

  let itemOwned: boolean | null = null;
  if (itemUniqueName && owned) {
    itemOwned =
      owned.warframes.some((f) => f.uniqueName === itemUniqueName) ||
      owned.weapons.some((w) => w.uniqueName === itemUniqueName);
  }

  return {
    total,
    owned: ownedN,
    missing,
    underleveled,
    ownedParts,
    pct,
    itemOwned,
  };
}

export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Map display names → uniqueName using catalog mods + arcanes. */
export function buildNameIndex(catalog: Catalog): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of catalog.mods) {
    map.set(normalizeItemName(m.name), m.uniqueName);
  }
  for (const a of catalog.arcanes ?? []) {
    map.set(normalizeItemName(a.name), a.uniqueName);
  }
  for (const f of catalog.warframes) {
    map.set(normalizeItemName(f.name), f.uniqueName);
  }
  for (const w of catalog.weapons) {
    map.set(normalizeItemName(w.name), w.uniqueName);
  }
  return map;
}

export function partsFromNames(
  entries: { name: string; rank?: number | null; kind?: "mod" | "arcane" }[],
  nameIndex: Map<string, string>,
): BuildPart[] {
  const parts: BuildPart[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const un = nameIndex.get(normalizeItemName(e.name));
    if (!un || seen.has(un)) continue;
    seen.add(un);
    const isArcane = un.includes("/CosmeticEnhancers/");
    parts.push({
      uniqueName: un,
      name: e.name,
      kind: e.kind ?? (isArcane ? "arcane" : "mod"),
      rank: e.rank ?? null,
    });
  }
  return parts;
}
