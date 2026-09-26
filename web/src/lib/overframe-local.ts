import type { BuildPart, Craftability } from "@/lib/craftability";
import { scoreCraftability } from "@/lib/craftability";
import type { OwnedSnapshot } from "@/lib/types";

export type OverframeLocalBuild = {
  id: string;
  url: string;
  title: string;
  itemSlug: string;
  itemName?: string;
  itemUniqueName?: string | null;
  category?: string;
  votes: number;
  formas: number;
  parts: BuildPart[];
  partsCount?: number;
  author?: string;
  error?: string;
};

export type OverframeLocalDump = {
  source: "overframe";
  fetchedAt?: string;
  category?: string;
  itemFilter?: string | null;
  count: number;
  builds: OverframeLocalBuild[];
};

export async function loadOverframeLocalBuilds(): Promise<OverframeLocalDump | null> {
  try {
    const res = await fetch(`/data/overframe_builds.json?t=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as OverframeLocalDump;
  } catch {
    return null;
  }
}

export function scoreOverframeBuild(
  build: OverframeLocalBuild,
  owned: OwnedSnapshot | null,
): Craftability {
  return scoreCraftability(
    build.parts ?? [],
    owned,
    build.itemUniqueName ?? null,
  );
}
