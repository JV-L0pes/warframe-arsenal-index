import { describe, expect, it } from "vitest";
import { extractArsenyxParts, scoreCraftability } from "@/lib/craftability";
import type { OwnedSnapshot } from "@/lib/types";

const owned: OwnedSnapshot = {
  mods: [
    { uniqueName: "/mod/a", rank: 10, count: 1 },
    { uniqueName: "/mod/b", rank: 2, count: 1 },
  ],
  arcanes: [{ uniqueName: "/arcane/x", rank: 5, count: 1 }],
  weapons: [{ uniqueName: "/weapon/w", slot: "primary" }],
  warframes: [],
};

describe("scoreCraftability", () => {
  it("separates absent from low-rank parts", () => {
    const craft = scoreCraftability(
      [
        { uniqueName: "/mod/a", name: "A", kind: "mod", rank: 8 },
        { uniqueName: "/mod/b", name: "B", kind: "mod", rank: 5 },
        { uniqueName: "/mod/c", name: "C", kind: "mod", rank: 0 },
        { uniqueName: "/arcane/x", name: "X", kind: "arcane", rank: 5 },
      ],
      owned,
      "/weapon/w",
    );
    expect(craft.pct).toBe(50);
    expect(craft.owned).toBe(2);
    expect(craft.missing).toEqual([
      expect.objectContaining({
        uniqueName: "/mod/b",
        reason: "low_rank",
        ownedRank: 2,
      }),
      expect.objectContaining({
        uniqueName: "/mod/c",
        reason: "absent",
        ownedRank: null,
      }),
    ]);
    expect(craft.underleveled).toHaveLength(1);
    expect(craft.itemOwned).toBe(true);
  });

  it("treats unranked requirements as met and empty builds as 100%", () => {
    expect(
      scoreCraftability(
        [{ uniqueName: "/mod/a", name: "A", kind: "mod", rank: null }],
        owned,
      ).pct,
    ).toBe(100);
    expect(scoreCraftability([], owned).pct).toBe(100);
  });
});

describe("extractArsenyxParts", () => {
  it("collects deduped mods and arcanes from buildData", () => {
    const parts = extractArsenyxParts({
      slots: {
        s1: { mod: { uniqueName: "/mod/a", name: "A" }, rank: 7 },
        s2: { mod: { uniqueName: "/mod/a", name: "A" }, rank: 7 },
        s3: { mod: { uniqueName: "/mod/b", name: "B" } },
      },
      arcanes: [{ arcane: { uniqueName: "/arcane/x", name: "X" }, rank: 3 }],
    });
    expect(parts).toEqual([
      { uniqueName: "/mod/a", name: "A", kind: "mod", rank: 7 },
      { uniqueName: "/mod/b", name: "B", kind: "mod", rank: null },
      { uniqueName: "/arcane/x", name: "X", kind: "arcane", rank: 3 },
    ]);
    expect(extractArsenyxParts(null)).toEqual([]);
  });
});
