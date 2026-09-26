import { describe, expect, it } from "vitest";
import { isBaseMasteryDone, rankFromXp, xpForRank } from "@/lib/affinity";

describe("affinity", () => {
  it("uses 1000*n^2 for warframes and 500*n^2 for weapons", () => {
    expect(xpForRank("warframe", 2)).toBe(4000);
    expect(xpForRank("weapon", 3)).toBe(4500);
    expect(xpForRank("weapon", 0)).toBe(0);
  });

  it("derives the highest rank the xp reaches, capped at 30", () => {
    expect(rankFromXp("weapon", 0)).toBe(0);
    expect(rankFromXp("weapon", 499)).toBe(0);
    expect(rankFromXp("weapon", 500)).toBe(1);
    expect(rankFromXp("weapon", 4500)).toBe(3);
    expect(rankFromXp("weapon", 450_000)).toBe(30);
    expect(rankFromXp("weapon", undefined)).toBe(0);
  });

  it("marks base mastery done on rank 30 or after any Forma", () => {
    expect(isBaseMasteryDone({ rank: 30 })).toBe(true);
    expect(isBaseMasteryDone({ rank: 29 })).toBe(false);
    expect(isBaseMasteryDone({ rank: 5, polarized: 1 })).toBe(true);
  });
});
