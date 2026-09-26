export type ArsenyxCategory =
  | "warframes"
  | "primary"
  | "secondary"
  | "melee"
  | "necramechs"
  | "companions"
  | "companion-weapons"
  | "exalted-weapons"
  | "archwing"
  | "railjack";

export type ArsenyxSort =
  | "newest"
  | "updated"
  | "top"
  | "bookmarked"
  | "viewed"
  | "trending"
  | "forma-asc"
  | "forma-desc"
  | "name-asc";

export type ArsenyxBuildSummary = {
  id: string;
  slug: string;
  name: string;
  visibility: string;
  likeCount: number;
  bookmarkCount: number;
  viewCount: number;
  formaCount: number;
  hasGuide: boolean;
  hasShards: boolean;
  hideAuthor: boolean;
  createdAt: string;
  updatedAt: string;
  item: {
    uniqueName: string;
    name: string;
    imageName?: string;
    category: string;
  };
  user: {
    id: string;
    name?: string | null;
    username?: string | null;
    displayUsername?: string | null;
    image?: string | null;
  } | null;
  organization?: { name: string; slug: string } | null;
};

export type ArsenyxBuildList = {
  builds: ArsenyxBuildSummary[];
  total: number;
  page: number;
  limit: number;
};

export type ArsenyxBuildDetail = ArsenyxBuildSummary & {
  description?: string | null;
  buildData?: unknown;
  guide?: {
    summary?: string | null;
    description?: string | null;
  } | null;
};

export const ARSENYX_CATEGORIES: { id: ArsenyxCategory | "all"; label: string }[] =
  [
    { id: "all", label: "All" },
    { id: "warframes", label: "Warframes" },
    { id: "primary", label: "Primary" },
    { id: "secondary", label: "Secondary" },
    { id: "melee", label: "Melee" },
    { id: "companions", label: "Companions" },
    { id: "archwing", label: "Archwing" },
    { id: "necramechs", label: "Necramechs" },
  ];

export function arsenyxBuildUrl(slug: string): string {
  return `https://www.arsenyx.com/builds/${slug}`;
}

export type ListBuildsParams = {
  page?: number;
  limit?: number;
  sort?: ArsenyxSort;
  q?: string;
  category?: ArsenyxCategory | "all";
  /** Exact item uniqueName */
  item?: string;
};

const detailCache = new Map<
  string,
  { at: number; data: ArsenyxBuildDetail }
>();
const DETAIL_TTL_MS = 10 * 60 * 1000;

export async function listArsenyxBuilds(
  params: ListBuildsParams = {},
): Promise<ArsenyxBuildList> {
  const sp = new URLSearchParams();
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.sort) sp.set("sort", params.sort);
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.category && params.category !== "all") {
    sp.set("category", params.category);
  }
  if (params.item?.trim()) sp.set("item", params.item.trim());

  const res = await fetch(`/api/arsenyx/builds?${sp.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string" ? body.error : `Arsenyx list HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<ArsenyxBuildList>;
}

export async function getArsenyxBuild(slug: string): Promise<ArsenyxBuildDetail> {
  const cached = detailCache.get(slug);
  if (cached && Date.now() - cached.at < DETAIL_TTL_MS) {
    return cached.data;
  }

  const res = await fetch(`/api/arsenyx/builds/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `Arsenyx detail HTTP ${res.status}`,
    );
  }
  const data = (await res.json()) as ArsenyxBuildDetail;
  detailCache.set(slug, { at: Date.now(), data });
  return data;
}

/** Prefetch details with limited concurrency (for craft % filters). */
export async function prefetchArsenyxBuilds(
  slugs: string[],
  concurrency = 3,
  onEach?: (slug: string, detail: ArsenyxBuildDetail | null) => void,
): Promise<void> {
  const queue = [...slugs];
  async function worker() {
    while (queue.length) {
      const slug = queue.shift();
      if (!slug) return;
      try {
        const d = await getArsenyxBuild(slug);
        onEach?.(slug, d);
      } catch {
        onEach?.(slug, null);
      }
    }
  }
  const n = Math.max(1, Math.min(concurrency, slugs.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
}
