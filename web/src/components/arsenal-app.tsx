"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  buildCategorizedLists,
  formatSyncedAt,
  isInventoryStale,
  OWNED_STORAGE_KEY,
  parseInventoryFile,
  STALE_AFTER_DAYS,
} from "@/lib/inventory";
import {
  MOD_CATEGORY_META,
  polarityLabel,
  type Catalog,
  type OwnershipFilter,
  type OwnedSnapshot,
  type Section,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { DisclaimerDialog } from "@/components/disclaimer-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Props = {
  catalog: Catalog;
  initialOwned: OwnedSnapshot | null;
};

export function ArsenalApp({ catalog, initialOwned }: Props) {
  const [owned, setOwned] = useState<OwnedSnapshot | null>(initialOwned);
  const [section, setSection] = useState<Section>("mods");
  const [category, setCategory] = useState<string>("rifle");
  const [filter, setFilter] = useState<OwnershipFilter>("all");
  const [query, setQuery] = useState("");
  const [hideAugments, setHideAugments] = useState(true);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OWNED_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      const result = parseInventoryFile(parsed);
      if (result.ok) setOwned(result.owned);
    } catch {
      /* ignore */
    }
  }, []);

  const persistOwned = useCallback((next: OwnedSnapshot | null) => {
    setOwned(next);
    if (next) localStorage.setItem(OWNED_STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(OWNED_STORAGE_KEY);
  }, []);

  const ownedModMap = useMemo(() => {
    const m = new Map<string, { rank: number | null; count: number }>();
    for (const o of owned?.mods ?? []) {
      m.set(o.uniqueName, { rank: o.rank, count: o.count });
    }
    return m;
  }, [owned]);

  const ownedWeaponSet = useMemo(
    () => new Set((owned?.weapons ?? []).map((w) => w.uniqueName)),
    [owned],
  );
  const ownedFrameSet = useMemo(
    () => new Set((owned?.warframes ?? []).map((f) => f.uniqueName)),
    [owned],
  );

  const categoryCounts = useMemo(() => {
    const counts: Record<string, { total: number; owned: number }> = {};
    for (const mod of catalog.mods) {
      if (hideAugments && mod.isAugment) continue;
      const c = mod.category;
      if (!counts[c]) counts[c] = { total: 0, owned: 0 };
      counts[c].total += 1;
      if (ownedModMap.has(mod.uniqueName)) counts[c].owned += 1;
    }
    return counts;
  }, [catalog.mods, hideAugments, ownedModMap]);

  const filteredMods = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.mods.filter((mod) => {
      if (mod.category !== category) return false;
      if (hideAugments && mod.isAugment) return false;
      const isOwned = ownedModMap.has(mod.uniqueName);
      if (filter === "owned" && !isOwned) return false;
      if (filter === "missing" && isOwned) return false;
      if (!q) return true;
      return (
        mod.name.toLowerCase().includes(q) ||
        (mod.compatName ?? "").toLowerCase().includes(q)
      );
    });
  }, [catalog.mods, category, filter, hideAugments, ownedModMap, query]);

  const weaponSlot =
    category === "primary" || category === "secondary" || category === "melee"
      ? category
      : "primary";

  const filteredWeapons = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.weapons.filter((w) => {
      if (w.slot !== weaponSlot) return false;
      const isOwned = ownedWeaponSet.has(w.uniqueName);
      if (filter === "owned" && !isOwned) return false;
      if (filter === "missing" && isOwned) return false;
      if (!q) return true;
      return w.name.toLowerCase().includes(q) || w.subtype.includes(q);
    });
  }, [catalog.weapons, filter, ownedWeaponSet, query, weaponSlot]);

  const filteredFrames = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.warframes.filter((f) => {
      const isOwned = ownedFrameSet.has(f.uniqueName);
      if (filter === "owned" && !isOwned) return false;
      if (filter === "missing" && isOwned) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q);
    });
  }, [catalog.warframes, filter, ownedFrameSet, query]);

  const progress = useMemo(() => {
    if (section === "mods") {
      const c = categoryCounts[category] ?? { total: 0, owned: 0 };
      return c;
    }
    if (section === "weapons") {
      const list = catalog.weapons.filter((w) => w.slot === weaponSlot);
      const ownedN = list.filter((w) => ownedWeaponSet.has(w.uniqueName)).length;
      return { total: list.length, owned: ownedN };
    }
    const ownedN = catalog.warframes.filter((f) =>
      ownedFrameSet.has(f.uniqueName),
    ).length;
    return { total: catalog.warframes.length, owned: ownedN };
  }, [
    section,
    categoryCounts,
    category,
    catalog.weapons,
    catalog.warframes,
    weaponSlot,
    ownedWeaponSet,
    ownedFrameSet,
  ]);

  const pct =
    progress.total === 0 ? 0 : Math.round((progress.owned / progress.total) * 100);

  async function onImportFile(file: File) {
    const text = await file.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("File is not valid JSON.");
    }
    const result = parseInventoryFile(data, undefined, {
      syncedAt: new Date(file.lastModified).toISOString(),
      source: "import",
    });
    if (!result.ok) throw new Error(result.error);
    persistOwned(result.owned);
  }

  function exportLists() {
    const lists = buildCategorizedLists(catalog, owned);
    const blob = new Blob([JSON.stringify(lists, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inventory_lists.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyLists() {
    const lists = buildCategorizedLists(catalog, owned);
    await navigator.clipboard.writeText(JSON.stringify(lists, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const groups = useMemo(() => {
    const map = new Map<string, typeof MOD_CATEGORY_META>();
    for (const meta of MOD_CATEGORY_META) {
      if (!categoryCounts[meta.id]?.total) continue;
      const arr = map.get(meta.group) ?? [];
      arr.push(meta);
      map.set(meta.group, arr);
    }
    return [...map.entries()];
  }, [categoryCounts]);

  const stale = isInventoryStale(owned);
  const syncLabel = formatSyncedAt(owned);

  return (
    <div className="flex min-h-screen flex-col">
      <DisclaimerDialog />
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-[1400px] items-end justify-between gap-6 px-6 py-8">
          <div>
            <p className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
              Warframe · Personal tool
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Arsenal Index
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Full mod catalog from Public Export. Import your inventory dump
              to mark ownership, then export categorized lists.
            </p>
          </div>
          <div className="hidden flex-col items-end gap-2 sm:flex">
            <div className="flex items-center gap-2">
              {owned?.account ? (
                <Badge variant="outline" className="font-mono text-[11px]">
                  {owned.account}
                </Badge>
              ) : (
                <Badge variant="outline" className="font-mono text-[11px]">
                  no inventory
                </Badge>
              )}
              <Badge variant="secondary" className="font-mono text-[11px]">
                {catalog.mods.length} mods
              </Badge>
            </div>
            {owned && (
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[11px]",
                  stale && "border-foreground/40 text-foreground",
                )}
              >
                {stale ? `stale · ${syncLabel}` : `synced ${syncLabel}`}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-0 md:flex-row">
        <aside className="w-full shrink-0 border-b border-border md:w-56 md:border-r md:border-b-0">
          <div className="sticky top-0 space-y-6 p-4 md:p-5">
            <nav className="flex gap-1 md:flex-col">
              {(
                [
                  ["mods", "Mods"],
                  ["weapons", "Weapons"],
                  ["warframes", "Warframes"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setSection(id);
                    if (id === "weapons") setCategory("primary");
                    if (id === "mods") setCategory("rifle");
                    if (id === "warframes") setCategory("warframes");
                  }}
                  className={cn(
                    "rounded-md px-3 py-2 text-left text-sm transition-colors",
                    section === id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>

            {section === "mods" && (
              <div className="space-y-4">
                {groups.map(([group, items]) => (
                  <div key={group}>
                    <p className="mb-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                      {group}
                    </p>
                    <ul className="space-y-0.5">
                      {items.map((item) => {
                        const c = categoryCounts[item.id];
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => setCategory(item.id)}
                              className={cn(
                                "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors",
                                category === item.id
                                  ? "bg-muted text-foreground"
                                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                              )}
                            >
                              <span>{item.label}</span>
                              <span className="font-mono text-[10px] tabular-nums opacity-70">
                                {c?.owned ?? 0}/{c?.total ?? 0}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {section === "weapons" && (
              <ul className="space-y-0.5">
                {(["primary", "secondary", "melee"] as const).map((slot) => (
                  <li key={slot}>
                    <button
                      type="button"
                      onClick={() => setCategory(slot)}
                      className={cn(
                        "w-full rounded-md px-2.5 py-1.5 text-left text-sm capitalize transition-colors",
                        category === slot
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      {slot}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {stale && owned && (
            <div className="border-b border-border px-4 py-3 md:px-6">
              <Alert className="border-border bg-muted/30">
                <AlertTitle className="font-mono text-xs tracking-wide uppercase">
                  Inventory older than {STALE_AFTER_DAYS} days
                </AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground">
                  Last sync {syncLabel}. Re-run{" "}
                  <code className="font-mono text-foreground/80">
                    python3 scripts/export.py
                  </code>{" "}
                  with Warframe open, then Import JSON.
                </AlertDescription>
              </Alert>
            </div>
          )}
          <div className="border-b border-border px-4 py-4 md:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-lg font-medium capitalize tracking-tight">
                    {section === "mods"
                      ? (MOD_CATEGORY_META.find((m) => m.id === category)
                          ?.label ?? category)
                      : section === "weapons"
                        ? category
                        : "Warframes"}
                  </h2>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {progress.owned}/{progress.total} · {pct}%
                  </span>
                </div>
                <Progress value={pct} className="h-1 max-w-sm" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      await onImportFile(file);
                    } catch (err) {
                      alert(
                        err instanceof Error
                          ? err.message
                          : "Could not parse JSON.",
                      );
                    }
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  Import JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportLists}
                  disabled={!owned}
                >
                  Export lists
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyLists}
                  disabled={!owned}
                >
                  {copied ? "Copied" : "Copy JSON"}
                </Button>
                {owned && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => persistOwned(null)}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="max-w-sm bg-transparent"
              />
              <div className="flex gap-1">
                {(
                  [
                    ["all", "All"],
                    ["owned", "Owned"],
                    ["missing", "Missing"],
                  ] as const
                ).map(([id, label]) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={filter === id ? "default" : "ghost"}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {section === "mods" && (
                <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={hideAugments}
                    onCheckedChange={(v) => setHideAugments(Boolean(v))}
                  />
                  Hide augments
                </label>
              )}
            </div>
          </div>

          <ScrollArea className="h-[calc(100vh-14rem)]">
            <div className="px-2 py-2 md:px-4">
              {section === "mods" && (
                <ul className="divide-y divide-border">
                  {filteredMods.map((mod) => {
                    const o = ownedModMap.get(mod.uniqueName);
                    return (
                      <li
                        key={mod.uniqueName}
                        className="grid grid-cols-[1fr_auto] items-center gap-3 px-2 py-2.5 md:grid-cols-[1fr_100px_90px_70px]"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                o ? "bg-foreground" : "bg-border",
                              )}
                            />
                            <span
                              className={cn(
                                "truncate text-sm",
                                o ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {mod.name}
                            </span>
                            {mod.isAugment && (
                              <span className="font-mono text-[10px] text-muted-foreground">
                                AUG
                              </span>
                            )}
                          </div>
                          {mod.compatName && (
                            <p className="mt-0.5 truncate pl-3.5 font-mono text-[10px] text-muted-foreground">
                              {mod.compatName}
                            </p>
                          )}
                        </div>
                        <span className="hidden font-mono text-[11px] text-muted-foreground md:block">
                          {polarityLabel(mod.polarity)}
                        </span>
                        <span className="hidden font-mono text-[11px] text-muted-foreground uppercase md:block">
                          {mod.rarity?.toLowerCase() ?? "—"}
                        </span>
                        <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                          {o
                            ? `r${o.rank ?? "—"}` +
                              (o.count > 1 ? ` ×${o.count}` : "")
                            : "—"}
                        </span>
                      </li>
                    );
                  })}
                  {filteredMods.length === 0 && (
                    <li className="px-3 py-12 text-center text-sm text-muted-foreground">
                      No mods match.
                    </li>
                  )}
                </ul>
              )}

              {section === "weapons" && (
                <ul className="divide-y divide-border">
                  {filteredWeapons.map((w) => {
                    const isOwned = ownedWeaponSet.has(w.uniqueName);
                    return (
                      <li
                        key={w.uniqueName}
                        className="flex items-center justify-between gap-3 px-2 py-2.5"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              isOwned ? "bg-foreground" : "bg-border",
                            )}
                          />
                          <span
                            className={cn(
                              "truncate text-sm",
                              isOwned
                                ? "text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {w.name}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-muted-foreground capitalize">
                          {w.subtype}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {section === "warframes" && (
                <ul className="divide-y divide-border">
                  {filteredFrames.map((f) => {
                    const isOwned = ownedFrameSet.has(f.uniqueName);
                    return (
                      <li
                        key={f.uniqueName}
                        className="flex items-center gap-2 px-2 py-2.5"
                      >
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            isOwned ? "bg-foreground" : "bg-border",
                          )}
                        />
                        <span
                          className={cn(
                            "text-sm",
                            isOwned
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {f.name}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </ScrollArea>

          <footer className="mt-auto border-t border-border px-4 py-3 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <p className="font-mono">
                {catalog.generatedFrom}
                {catalog.generatedAt ? ` · ${catalog.generatedAt}` : ""}
                {" · Unofficial"}
              </p>
              <Separator orientation="vertical" className="hidden h-3 sm:block" />
              <p>
                Fetch inventory with{" "}
                <code className="font-mono text-foreground/80">
                  python3 scripts/export.py
                </code>
              </p>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
