/** Affinity → rank. Wiki: warframe/companion = 1000×n², weapon = 500×n². */

export type AffinityKind = "warframe" | "weapon";

export function xpForRank(kind: AffinityKind, rank: number): number {
  const n = Math.max(0, Math.floor(rank));
  const unit = kind === "warframe" ? 1000 : 500;
  return unit * n * n;
}

/**
 * Highest rank for given XP.
 * Caps at 30 by default — XP keeps climbing after max without raising displayed rank
 * (unless overlevel gear; not modeled here yet).
 */
export function rankFromXp(
  kind: AffinityKind,
  xp: number | undefined | null,
  maxRank = 30,
): number {
  if (xp == null || xp < 0) return 0;
  let rank = 0;
  const cap = Math.min(40, Math.max(1, maxRank));
  for (let n = 1; n <= cap; n++) {
    if (xp >= xpForRank(kind, n)) rank = n;
    else break;
  }
  return rank;
}

/**
 * Base mastery (ranks 1–30) is done if:
 * - at least one Forma was applied (`Polarized` ≥ 1), or
 * - current XP already reaches rank 30.
 *
 * Note: Kuva/Tenet overlevels (31–40) can still grant MR after Forma; we only
 * mark base mastery here.
 */
export function isBaseMasteryDone(opts: {
  polarized?: number | null;
  rank?: number | null;
}): boolean {
  const polarized = opts.polarized ?? 0;
  if (polarized >= 1) return true;
  return (opts.rank ?? 0) >= 30;
}
