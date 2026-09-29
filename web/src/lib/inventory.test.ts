import { describe, expect, it } from "vitest";
import {
  buildCategorizedLists,
  buildCsv,
  buildInventoryRows,
  enrichOwnedSnapshot,
  exportScopeSlug,
  isInventoryStale,
  isMasteryDoneFromXp,
  masteryKind,
  parseInventoryFile,
  parseRawInventory,
  STALE_AFTER_DAYS,
} from "@/lib/inventory";
import type { Catalog, OwnedSnapshot } from "@/lib/types";

const RAW = {
  Suits: [
    { ItemType: "/Lotus/Powersuits/Volt/VoltPrime", XP: 4000, Polarized: 1 },
  ],
  LongGuns: [
    { ItemType: "/Lotus/Weapons/Tenno/Bows/Nataruk", XP: 4500, Polarized: 0 },
  ],
  RawUpgrades: [
    {
      ItemType: "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod",
      ItemCount: 2,
      UpgradeFingerprint: '{"lvl":5}',
    },
    {
      ItemType: "/Lotus/Upgrades/CosmeticEnhancers/Offensive/MeleeDamage",
      ItemCount: 1,
      UpgradeFingerprint: '{"lvl":3}',
    },
  ],
  Upgrades: [
    {
      ItemType: "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod",
      ItemCount: 1,
      UpgradeFingerprint: '{"lvl":10}',
    },
  ],
  XPInfo: [
    { ItemType: "/Lotus/Weapons/Tenno/Bows/Nataruk", XP: 450000 },
    { ItemType: "/Lotus/Powersuits/Volt/VoltPrime", XP: 900000 },
    { ItemType: "/Lotus/Weapons/Tenno/Melee/LongSword/LongSword", XP: 1000 },
  ],
  MiscItems: [
    { ItemType: "/Lotus/Types/Items/MiscItems/Ferrite", ItemCount: 70 },
    { ItemType: "/Lotus/Types/Items/MiscItems/Rubedo", ItemCount: 660 },
  ],
};

const MOD_UN = "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod";
const ARCANE_UN = "/Lotus/Upgrades/CosmeticEnhancers/Offensive/MeleeDamage";
const WEAPON_UN = "/Lotus/Weapons/Tenno/Bows/Nataruk";
const FRAME_UN = "/Lotus/Powersuits/Volt/VoltPrime";

describe("parseRawInventory", () => {
  it("sums unranked raw stacks with ranked instances (disjoint pools)", () => {
    const owned = parseRawInventory(RAW, "Tenno");
    expect(owned.account).toBe("Tenno");
    expect(owned.mods.find((m) => m.uniqueName === MOD_UN)).toMatchObject({
      rank: 10,
      count: 3,
    });
    expect(owned.mods.some((m) => m.uniqueName.includes("/CosmeticEnhancers/"))).toBe(
      false,
    );
    expect(owned.arcanes).toEqual([
      { uniqueName: ARCANE_UN, rank: 3, count: 1 },
    ]);
  });

  it("counts duplicate ranked instances of the same mod separately", () => {
    const owned = parseRawInventory({
      Upgrades: [
        { ItemType: MOD_UN, UpgradeFingerprint: '{"lvl":5}' },
        { ItemType: MOD_UN, UpgradeFingerprint: '{"lvl":5}' },
      ],
      RawUpgrades: [{ ItemType: MOD_UN, ItemCount: 2 }],
    });
    expect(owned.mods).toEqual([{ uniqueName: MOD_UN, rank: 5, count: 4 }]);
  });

  it("reads rank, Forma and mastery from raw game bins", () => {
    const owned = parseRawInventory(RAW);
    expect(owned.weapons[0]).toMatchObject({
      uniqueName: WEAPON_UN,
      slot: "primary",
      rank: 3,
      polarized: 0,
      masteryDone: false,
    });
    expect(owned.warframes[0].masteryDone).toBe(true);
  });

  it("collects lifetime XPInfo records — sold items included", () => {
    const owned = parseRawInventory(RAW, "Tenno");
    expect(owned.mastery).toEqual([
      { uniqueName: WEAPON_UN, xp: 450000 },
      { uniqueName: FRAME_UN, xp: 900000 },
      { uniqueName: "/Lotus/Weapons/Tenno/Melee/LongSword/LongSword", xp: 1000 },
    ]);
  });

  it("collects MiscItems resources with counts", () => {
    const owned = parseRawInventory(RAW, "Tenno");
    expect(owned.resources).toEqual([
      { uniqueName: "/Lotus/Types/Items/MiscItems/Ferrite", count: 70 },
      { uniqueName: "/Lotus/Types/Items/MiscItems/Rubedo", count: 660 },
    ]);
  });
});

describe("mastery from XPInfo", () => {
  it("classifies weapons and warframes by path", () => {
    expect(masteryKind(WEAPON_UN)).toBe("weapon");
    expect(masteryKind(FRAME_UN)).toBe("warframe");
    expect(masteryKind("/Lotus/Types/Friendly/Pets/CatbrowPet")).toBeNull();
  });

  it("uses rank-30 affinity thresholds per item kind", () => {
    expect(isMasteryDoneFromXp(WEAPON_UN, 450000)).toBe(true);
    expect(isMasteryDoneFromXp(WEAPON_UN, 449999)).toBe(false);
    expect(isMasteryDoneFromXp(FRAME_UN, 900000)).toBe(true);
    expect(isMasteryDoneFromXp(FRAME_UN, 899999)).toBe(false);
  });
});

describe("enrichOwnedSnapshot", () => {
  it("migrates legacy CosmeticEnhancers mods into arcanes", () => {
    const legacy: OwnedSnapshot = {
      mods: [
        { uniqueName: ARCANE_UN, rank: 2, count: 1 },
        { uniqueName: MOD_UN, rank: 5, count: 1 },
      ],
      weapons: [{ uniqueName: "/weapon/w", xp: 500, slot: "primary" }],
      warframes: [],
      arcanes: [{ uniqueName: ARCANE_UN, rank: 4, count: 2 }],
    };
    const owned = enrichOwnedSnapshot(legacy);
    expect(owned.mods).toHaveLength(1);
    expect(owned.arcanes).toEqual([
      { uniqueName: ARCANE_UN, rank: 4, count: 2 },
    ]);
    expect(owned.weapons[0]).toMatchObject({ rank: 1, masteryDone: false });
  });

  it("marks owned gear mastered when XPInfo remembers it (sold and re-acquired)", () => {
    const owned = enrichOwnedSnapshot({
      mods: [],
      weapons: [{ uniqueName: WEAPON_UN, xp: 500, slot: "primary" }],
      warframes: [],
      mastery: [{ uniqueName: WEAPON_UN, xp: 450000 }],
    });
    expect(owned.weapons[0]).toMatchObject({ rank: 1, masteryDone: true });
  });
});

describe("parseInventoryFile", () => {
  it("rejects unrecognized files", () => {
    const result = parseInventoryFile({ foo: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unrecognized");
  });

  it("accepts inventory.php dumps", () => {
    expect(parseInventoryFile(RAW).ok).toBe(true);
  });
});

describe("staleness", () => {
  it("flags old snapshots and present-but-undated ones", () => {
    const old = new Date(
      Date.now() - (STALE_AFTER_DAYS + 1) * 86_400_000,
    ).toISOString();
    expect(
      isInventoryStale({
        mods: [],
        weapons: [],
        warframes: [],
        syncedAt: old,
      }),
    ).toBe(true);
    expect(isInventoryStale({ mods: [], weapons: [], warframes: [] })).toBe(true);
    expect(isInventoryStale(null)).toBe(false);
  });
});

const CATALOG: Catalog = {
  generatedFrom: "test",
  mods: [{ uniqueName: MOD_UN, name: "Serration", category: "rifle" }],
  weapons: [
    { uniqueName: WEAPON_UN, name: "Nataruk", slot: "primary", subtype: "bow" },
  ],
  warframes: [{ uniqueName: FRAME_UN, name: "Volt Prime" }],
  arcanes: [{ uniqueName: ARCANE_UN, name: "Arcane Fury" }],
  resources: [
    { uniqueName: "/Lotus/Types/Items/MiscItems/Rubedo", name: "Rubedo" },
    { uniqueName: "/Lotus/Types/Items/MiscItems/Ferrite", name: "Ferrite" },
  ],
};

describe("buildCategorizedLists", () => {
  it("exports mods/arcanes as names and gear as status objects", () => {
    const owned = parseRawInventory(RAW, "Tenno");
    const lists = buildCategorizedLists(CATALOG, owned, "all");
    expect(lists.mods_rifle).toEqual(["Serration"]);
    expect(lists.arcanes).toEqual(["Arcane Fury"]);
    expect(lists.warframes).toEqual([
      expect.objectContaining({
        name: "Volt Prime",
        masteryDone: true,
        mastery: "done",
      }),
    ]);
    expect(lists.primary_bow).toEqual([
      expect.objectContaining({ name: "Nataruk", rank: 3, mastery: "open" }),
    ]);
  });

  it("accepts a combination of sections", () => {
    const owned = parseRawInventory(RAW, "Tenno");
    const lists = buildCategorizedLists(CATALOG, owned, ["mods", "warframes"]);
    expect(lists.mods_rifle).toEqual(["Serration"]);
    expect(lists.warframes).toHaveLength(1);
    expect(lists.arcanes).toBeUndefined();
    expect(lists.primary_bow).toBeUndefined();
  });

  it("exports resources with counts, sorted by name", () => {
    const owned = parseRawInventory(RAW, "Tenno");
    const lists = buildCategorizedLists(CATALOG, owned, ["resources"]);
    expect(lists.resources).toEqual([
      { name: "Ferrite", count: 70 },
      { name: "Rubedo", count: 660 },
    ]);
    expect(lists.mods_rifle).toBeUndefined();
  });
});

describe("buildCsv", () => {
  it("flattens owned items under a stable header", () => {
    const owned = parseRawInventory(RAW, "Tenno");
    const csv = buildCsv(CATALOG, owned, "all");
    const lines = csv.replace("\uFEFF", "").trim().split("\r\n");
    expect(lines[0]).toBe(
      "type,name,group,subtype,rank,count,polarized,mastery",
    );
    expect(lines).toContain("mod,Serration,rifle,,10,3,,");
    expect(lines).toContain("arcane,Arcane Fury,arcane,,3,1,,");
    expect(lines).toContain("weapon,Nataruk,primary,bow,3,,0,open");
    expect(lines).toContain("warframe,Volt Prime,,,2,,1,done");
  });

  it("escapes separators and filters by scope", () => {
    const csv = buildCsv(
      {
        generatedFrom: "test",
        mods: [
          { uniqueName: "/m", name: 'Serration, "Prime"', category: "rifle" },
        ],
        weapons: [],
        warframes: [],
      },
      {
        mods: [{ uniqueName: "/m", rank: 0, count: 1 }],
        weapons: [],
        warframes: [],
      },
      "mods",
    );
    expect(csv).toContain('mod,"Serration, ""Prime""",rifle,,0,1,,');
    expect(csv).not.toContain("weapon,");
  });
});

describe("buildInventoryRows", () => {
  it("keeps numeric columns as numbers for spreadsheets", () => {
    const owned = parseRawInventory(RAW, "Tenno");
    const rows = buildInventoryRows(CATALOG, owned, "mods");
    expect(rows.find((r) => r[1] === "Serration")).toEqual([
      "mod",
      "Serration",
      "rifle",
      "",
      10,
      3,
      "",
      "",
    ]);
    expect(buildInventoryRows(CATALOG, owned, "weapons")).toContainEqual([
      "weapon",
      "Nataruk",
      "primary",
      "bow",
      3,
      "",
      0,
      "open",
    ]);
  });

  it("filters rows to a combination of sections", () => {
    const owned = parseRawInventory(RAW, "Tenno");
    const rows = buildInventoryRows(CATALOG, owned, ["weapons", "arcanes"]);
    expect(rows.some((r) => r[0] === "weapon" && r[1] === "Nataruk")).toBe(true);
    expect(rows.some((r) => r[0] === "arcane")).toBe(true);
    expect(rows.some((r) => r[0] === "mod")).toBe(false);
    expect(rows.some((r) => r[0] === "warframe")).toBe(false);
  });

  it("lists resource rows with counts", () => {
    const owned = parseRawInventory(RAW, "Tenno");
    const rows = buildInventoryRows(CATALOG, owned, "resources");
    expect(rows).toContainEqual(["resource", "Ferrite", "", "", "", 70, "", ""]);
    expect(rows).toContainEqual(["resource", "Rubedo", "", "", "", 660, "", ""]);
  });
});

describe("exportScopeSlug", () => {
  it("names combined scopes in canonical order", () => {
    expect(exportScopeSlug("all")).toBe("all");
    expect(exportScopeSlug(["mods"])).toBe("mods");
    expect(exportScopeSlug(["weapons", "mods"])).toBe("mods-weapons");
    expect(exportScopeSlug(["mods", "weapons", "warframes", "arcanes"])).toBe(
      "mods-weapons-warframes-arcanes",
    );
    expect(
      exportScopeSlug(["mods", "weapons", "warframes", "arcanes", "resources"]),
    ).toBe("all");
  });
});
