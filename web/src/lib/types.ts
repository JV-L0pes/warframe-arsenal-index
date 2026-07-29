export type ModRarity = "COMMON" | "UNCOMMON" | "RARE" | "LEGENDARY" | string;

export type ModCategory =
  | "warframe"
  | "aura"
  | "rifle"
  | "shotgun"
  | "sniper"
  | "bow"
  | "pistol"
  | "melee"
  | "stance"
  | "archwing"
  | "archgun"
  | "archmelee"
  | "robotic"
  | "companion"
  | "beast"
  | "parazon"
  | "necromech"
  | "kdrive"
  | "railjack"
  | "universal"
  | "other";

export type CatalogMod = {
  uniqueName: string;
  name: string;
  category: ModCategory | string;
  compatName?: string;
  type?: string;
  rarity?: ModRarity;
  polarity?: string;
  baseDrain?: number;
  fusionLimit?: number;
  isAugment?: boolean;
};

export type CatalogWeapon = {
  uniqueName: string;
  name: string;
  slot: string;
  subtype: string;
  /** how subtype was resolved */
  subtypeSource?: "warframestat" | "export" | "heuristic";
};

export type CatalogWarframe = {
  uniqueName: string;
  name: string;
  productCategory?: string;
};

export type Catalog = {
  generatedFrom: string;
  generatedAt?: string;
  filters?: string[];
  counts?: {
    mods: number;
    weapons: number;
    warframes: number;
  };
  mods: CatalogMod[];
  weapons: CatalogWeapon[];
  warframes: CatalogWarframe[];
};

export type OwnedMod = {
  uniqueName: string;
  rank: number | null;
  count: number;
};

export type OwnedWeapon = {
  uniqueName: string;
  slot: string;
  xp?: number;
  rank?: number;
  /** Forma applications — each resets to rank 0 */
  polarized?: number;
  /** Ranks 1–30 mastery already claimed (no more MR from releveling those ranks) */
  masteryDone?: boolean;
};

export type OwnedWarframe = {
  uniqueName: string;
  xp?: number;
  rank?: number;
  polarized?: number;
  masteryDone?: boolean;
};

export type OwnedSnapshot = {
  account?: string;
  /** ISO timestamp when this dump was fetched/imported */
  syncedAt?: string;
  /** e.g. mobile-api | import | example */
  source?: string;
  mods: OwnedMod[];
  weapons: OwnedWeapon[];
  warframes: OwnedWarframe[];
};

export type OwnershipFilter = "all" | "owned" | "missing";

export type Section = "mods" | "weapons" | "warframes";

export const MOD_CATEGORY_META: {
  id: ModCategory | string;
  label: string;
  group: string;
}[] = [
  { id: "warframe", label: "Warframe", group: "Frames" },
  { id: "aura", label: "Aura", group: "Frames" },
  { id: "rifle", label: "Rifle", group: "Primary" },
  { id: "shotgun", label: "Shotgun", group: "Primary" },
  { id: "sniper", label: "Sniper", group: "Primary" },
  { id: "bow", label: "Bow", group: "Primary" },
  { id: "pistol", label: "Pistol", group: "Secondary" },
  { id: "melee", label: "Melee", group: "Melee" },
  { id: "stance", label: "Stance", group: "Melee" },
  { id: "archwing", label: "Archwing", group: "Archwing" },
  { id: "archgun", label: "Archgun", group: "Archwing" },
  { id: "archmelee", label: "Archmelee", group: "Archwing" },
  { id: "robotic", label: "Robotic", group: "Companions" },
  { id: "companion", label: "Companion", group: "Companions" },
  { id: "beast", label: "Beast", group: "Companions" },
  { id: "parazon", label: "Parazon", group: "Other" },
  { id: "necromech", label: "Necramech", group: "Other" },
  { id: "kdrive", label: "K-Drive", group: "Other" },
  { id: "railjack", label: "Railjack", group: "Other" },
  { id: "universal", label: "Universal", group: "Other" },
  { id: "pvp", label: "Conclave", group: "Other" },
  { id: "riven", label: "Riven", group: "Other" },
  { id: "other", label: "Other", group: "Other" },
];

export function polarityLabel(p?: string): string {
  if (!p) return "—";
  const map: Record<string, string> = {
    AP_ATTACK: "Madurai",
    AP_DEFENSE: "Vazarin",
    AP_TACTIC: "Naramon",
    AP_WARD: "Unairu",
    AP_POWER: "Zenurik",
    AP_PRECEPT: "Penjaga",
    AP_UMBRA: "Umbra",
    AP_ANY: "Any",
  };
  return map[p] ?? p.replace(/^AP_/, "");
}
