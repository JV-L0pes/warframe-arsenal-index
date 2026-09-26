"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  ARSENYX_CATEGORIES,
  arsenyxBuildUrl,
  getArsenyxBuild,
  listArsenyxBuilds,
  prefetchArsenyxBuilds,
  type ArsenyxBuildDetail,
  type ArsenyxBuildSummary,
  type ArsenyxCategory,
  type ArsenyxSort,
} from "@/lib/arsenyx";
import {
  extractArsenyxParts,
  scoreCraftability,
  type Craftability,
} from "@/lib/craftability";
import type { Catalog, OwnedSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { OverframeBuildsPanel } from "@/components/overframe-builds-panel";

type Props = {
  catalog: Catalog;
  owned: OwnedSnapshot | null;
};

type BuildSource = "arsenyx" | "overframe";

const MIN_CRAFT = [
  { id: 0, label: "Any %" },
  { id: 50, label: "≥50%" },
  { id: 80, label: "≥80%" },
  { id: 100, label: "100%" },
] as const;

const EMPTY_LIST: ArsenyxBuildSummary[] = [];

export function BuildsPanel({ catalog, owned }: Props) {
  const [source, setSource] = useState<BuildSource>("overframe");
  const [category, setCategory] = useState<ArsenyxCategory | "all">("warframes");
  const [sort, setSort] = useState<ArsenyxSort>("top");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [minCraft, setMinCraft] = useState(0);
  const [ownedItemsOnly, setOwnedItemsOnly] = useState(Boolean(owned));
  const [itemFilter, setItemFilter] = useState<string>("");
  const [list, setList] = useState<ArsenyxBuildSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [scores, setScores] = useState<Record<string, Craftability>>({});
  const [scoring, setScoring] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArsenyxBuildDetail | null>(null);

  const ownedItemOptions = useMemo(() => {
    if (!owned) return [];
    const nameByUn = new Map<string, string>();
    for (const f of catalog.warframes) nameByUn.set(f.uniqueName, f.name);
    for (const w of catalog.weapons) nameByUn.set(w.uniqueName, w.name);
    const opts: { uniqueName: string; name: string; kind: string }[] = [];

    const wantFrames =
      category === "all" || category === "warframes";
    const wantSlots = new Set<string>();
    if (category === "all") {
      wantSlots.add("primary");
      wantSlots.add("secondary");
      wantSlots.add("melee");
    } else if (
      category === "primary" ||
      category === "secondary" ||
      category === "melee"
    ) {
      wantSlots.add(category);
    }
    // other Arsenyx cats (companions, archwing, …) — no owned bins yet

    if (wantFrames) {
      for (const f of owned.warframes) {
        opts.push({
          uniqueName: f.uniqueName,
          name: nameByUn.get(f.uniqueName) ?? f.uniqueName.split("/").pop()!,
          kind: "frame",
        });
      }
    }
    if (wantSlots.size) {
      for (const w of owned.weapons) {
        if (!wantSlots.has(w.slot)) continue;
        opts.push({
          uniqueName: w.uniqueName,
          name: nameByUn.get(w.uniqueName) ?? w.uniqueName.split("/").pop()!,
          kind: w.slot,
        });
      }
    }
    return opts.sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog, owned, category]);

  // Derive the effective item filter instead of syncing it via effect.
  const itemStillValid =
    !ownedItemsOnly ||
    !owned ||
    ownedItemOptions.some((o) => o.uniqueName === itemFilter);
  const effectiveItemFilter = itemStillValid
    ? itemFilter
    : ownedItemsOnly && owned
      ? ((ownedItemOptions.find((o) => o.kind === "frame") ??
          ownedItemOptions[0])?.uniqueName ?? "")
      : itemFilter;
  const apiItem = effectiveItemFilter || undefined;
  const needItemPick = ownedItemsOnly && !effectiveItemFilter;

  useEffect(() => {
    if (source !== "arsenyx") return;
    if (needItemPick) return;
    let cancelled = false;
    startTransition(async () => {
      setListError(null);
      try {
        const data = await listArsenyxBuilds({
          page,
          limit: 20,
          sort,
          q: query.trim() || undefined,
          category,
          item: apiItem,
        });
        if (cancelled) return;
        setList(data.builds);
        setTotal(data.total);
        setScores({});
        setExpanded(null);
        setDetail(null);
      } catch (err) {
        if (cancelled) return;
        setList([]);
        setTotal(0);
        setListError(err instanceof Error ? err.message : "Failed to load builds");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source, page, sort, query, category, apiItem, needItemPick]);

  const listItems = needItemPick ? EMPTY_LIST : list;
  const listTotal = needItemPick ? 0 : total;

  // Lazy score: only when minCraft filter needs it, or user clicks Score page
  async function scoreSlugs(slugs: string[]) {
    if (!slugs.length) return;
    setScoring(true);
    await prefetchArsenyxBuilds(slugs, 3, (slug, d) => {
      if (!d) return;
      const summary = listItems.find((b) => b.slug === slug);
      const craft = scoreCraftability(
        extractArsenyxParts(d.buildData),
        owned,
        summary?.item.uniqueName ?? d.item?.uniqueName,
      );
      setScores((prev) => ({ ...prev, [slug]: craft }));
    });
    setScoring(false);
  }

  useEffect(() => {
    if (source !== "arsenyx" || minCraft <= 0 || needItemPick || !list.length) {
      return;
    }
    const missing = list.map((b) => b.slug).filter((s) => !scores[s]);
    if (missing.length) {
      startTransition(() => {
        void scoreSlugs(missing);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- score when filter/list changes
  }, [source, minCraft, list, needItemPick]);

  const visible = useMemo(() => {
    if (minCraft <= 0) return listItems;
    return listItems.filter((b) => {
      const craft = scores[b.slug];
      if (!craft) return false;
      return craft.pct >= minCraft;
    });
  }, [listItems, scores, minCraft]);

  async function openDetail(slug: string) {
    if (expanded === slug) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(slug);
    setDetail(null);
    try {
      const d = await getArsenyxBuild(slug);
      setDetail(d);
      const craft = scoreCraftability(
        extractArsenyxParts(d.buildData),
        owned,
        d.item?.uniqueName,
      );
      setScores((prev) => ({ ...prev, [slug]: craft }));
    } catch {
      setDetail(null);
    }
  }

  return (
    <div className="space-y-6 px-2 py-4 md:px-4">
      {!owned && (
        <Alert className="border-border bg-muted/30">
          <AlertTitle className="font-mono text-xs tracking-wide uppercase">
            No inventory
          </AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            Import inventory JSON to score craftability (incl. mod ranks). You
            can still browse Arsenyx builds.
          </AlertDescription>
        </Alert>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["overframe", "Overframe (local)"],
              ["arsenyx", "Arsenyx"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={source === id ? "default" : "ghost"}
              onClick={() => setSource(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        {source === "overframe" ? (
          <OverframeBuildsPanel
            catalog={catalog}
            owned={owned}
            category={category}
            itemFilter={itemFilter}
            ownedItemsOnly={ownedItemsOnly}
            ownedItemOptions={ownedItemOptions}
            onCategoryChange={(c) => {
              setCategory(c as ArsenyxCategory | "all");
              setPage(1);
            }}
            onItemFilterChange={(v) => {
              setItemFilter(v);
              setPage(1);
            }}
            onOwnedItemsOnlyChange={(v) => {
              setOwnedItemsOnly(v);
              setPage(1);
              if (!v) setItemFilter("");
            }}
          />
        ) : (
          <>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-medium tracking-tight">
              Arsenyx builds
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Expand a row to score mods + ranks. Use craft filter to score the
              whole page (cached).
            </p>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {pending || scoring
              ? scoring
                ? "scoring…"
                : "loading…"
              : `${visible.length} shown · ${listTotal} total`}
          </span>
        </div>

        <div className="flex flex-wrap gap-1">
          {ARSENYX_CATEGORIES.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant={category === c.id ? "default" : "ghost"}
              onClick={() => {
                setCategory(c.id);
                setPage(1);
              }}
            >
              {c.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search builds…"
            className="max-w-sm bg-transparent"
          />
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as ArsenyxSort);
              setPage(1);
            }}
            className="h-8 rounded-md border border-border bg-muted px-2 text-sm text-foreground"
          >
            <option value="top">Top liked</option>
            <option value="newest">Newest</option>
            <option value="updated">Updated</option>
            <option value="trending">Trending</option>
            <option value="forma-asc">Fewest forma</option>
            <option value="viewed">Most viewed</option>
          </select>
          <select
            value={minCraft}
            onChange={(e) => setMinCraft(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-muted px-2 text-sm text-foreground"
          >
            {MIN_CRAFT.map((m) => (
              <option key={m.id} value={m.id}>
                Craft {m.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!listItems.length || scoring}
            onClick={() =>
              void scoreSlugs(
                listItems.map((b) => b.slug).filter((s) => !scores[s]),
              )
            }
          >
            Score page
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={ownedItemsOnly}
              onCheckedChange={(v) => {
                const on = Boolean(v);
                setOwnedItemsOnly(on);
                setPage(1);
                if (!on) setItemFilter("");
              }}
              disabled={!owned}
            />
            Only my item
          </label>
          <select
            value={effectiveItemFilter}
            onChange={(e) => {
              setItemFilter(e.target.value);
              setPage(1);
            }}
            className="h-8 max-w-xs rounded-md border border-border bg-muted px-2 text-sm text-foreground disabled:opacity-50"
            disabled={!owned}
          >
            <option value="">
              {ownedItemsOnly
                ? ownedItemOptions.length
                  ? "Select an owned item…"
                  : "Nothing owned in this category"
                : "Any item"}
            </option>
            {ownedItemOptions.map((o) => (
              <option key={o.uniqueName} value={o.uniqueName}>
                {o.name} ({o.kind})
              </option>
            ))}
          </select>
        </div>

        {needItemPick && (
          <p className="text-xs text-muted-foreground">
            Pick one of your warframes/weapons — filter uses Arsenyx{" "}
            <code className="font-mono">?item=</code> (real pagination).
          </p>
        )}

        {listError && (
          <p className="text-sm text-muted-foreground">{listError}</p>
        )}

        <ul className="divide-y divide-border">
          {visible.map((b) => {
            const craft = scores[b.slug];
            const isOpen = expanded === b.slug;
            const detailCraft =
              detail && detail.slug === b.slug
                ? scoreCraftability(
                    extractArsenyxParts(detail.buildData),
                    owned,
                    b.item.uniqueName,
                  )
                : craft;
            return (
              <li key={b.slug} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openDetail(b.slug)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium tracking-tight">
                        {b.name}
                      </span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {b.item.name}
                      </Badge>
                      {craft?.itemOwned === false && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          item missing
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {b.user?.displayUsername || b.user?.username || "anon"} ·{" "}
                      {b.formaCount} forma · {b.likeCount} likes
                      {!craft && " · click to score"}
                    </p>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "font-mono tabular-nums",
                        craft &&
                          craft.pct === 100 &&
                          "bg-foreground text-background",
                      )}
                    >
                      {craft ? `${craft.pct}%` : "—"}
                    </Badge>
                    <a
                      href={arsenyxBuildUrl(b.slug)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Arsenyx ↗
                    </a>
                  </div>
                </div>
                {craft && (
                  <Progress value={craft.pct} className="mt-2 h-1 max-w-md" />
                )}
                {isOpen && detailCraft && (
                  <div className="mt-3 space-y-2 rounded-md border border-border p-3">
                    <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                      {detailCraft.owned}/{detailCraft.total} ok
                      {detailCraft.underleveled.length
                        ? ` · ${detailCraft.underleveled.length} low rank`
                        : ""}
                    </p>
                    {detailCraft.missing.length > 0 ? (
                      <ul className="grid gap-1 sm:grid-cols-2">
                        {detailCraft.missing.map((m) => (
                          <li
                            key={`${m.uniqueName}-${m.reason}`}
                            className="font-mono text-[11px] text-muted-foreground"
                          >
                            <span className="text-foreground/80">{m.name}</span>
                            <span className="ml-1 opacity-60">
                              {m.reason === "low_rank"
                                ? `r${m.ownedRank ?? "?"}→${m.rank}`
                                : m.kind}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        You meet every mod/arcane at required rank.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {!pending && !needItemPick && visible.length === 0 && (
            <li className="py-12 text-center text-sm text-muted-foreground">
              {minCraft > 0 && scoring
                ? "Scoring page…"
                : minCraft > 0
                  ? "No builds on this page meet the craft filter."
                  : "No builds match these filters."}
            </li>
          )}
        </ul>

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </Button>
          <span className="font-mono text-[11px] text-muted-foreground">
            page {page}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={list.length === 0}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
          </>
        )}
      </section>
    </div>
  );
}
