"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  loadOverframeLocalBuilds,
  scoreOverframeBuild,
  type OverframeLocalBuild,
  type OverframeLocalDump,
} from "@/lib/overframe-local";
import type { Catalog, OwnedSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  catalog: Catalog;
  owned: OwnedSnapshot | null;
  category: string;
  itemFilter: string;
  ownedItemsOnly: boolean;
  ownedItemOptions: { uniqueName: string; name: string; kind: string }[];
  onCategoryChange: (c: string) => void;
  onItemFilterChange: (v: string) => void;
  onOwnedItemsOnlyChange: (v: boolean) => void;
};

const CATS = [
  { id: "all", label: "All" },
  { id: "warframes", label: "Warframes" },
  { id: "primary", label: "Primary" },
  { id: "secondary", label: "Secondary" },
  { id: "melee", label: "Melee" },
] as const;

const MIN_CRAFT = [
  { id: 0, label: "Any %" },
  { id: 50, label: "≥50%" },
  { id: 80, label: "≥80%" },
  { id: 100, label: "100%" },
] as const;

function scrapeCategory(category: string): string {
  if (
    category === "primary" ||
    category === "secondary" ||
    category === "melee" ||
    category === "warframes"
  ) {
    return category;
  }
  return "warframes";
}

export function OverframeBuildsPanel({
  catalog,
  owned,
  category,
  itemFilter,
  ownedItemsOnly,
  ownedItemOptions,
  onCategoryChange,
  onItemFilterChange,
  onOwnedItemsOnlyChange,
}: Props) {
  const [dump, setDump] = useState<OverframeLocalDump | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [minCraft, setMinCraft] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [scrapeName, setScrapeName] = useState("");
  const [scrapeLimit, setScrapeLimit] = useState(20);
  const [scraping, setScraping] = useState(false);
  const [scrapeLog, setScrapeLog] = useState<string | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const nameByUn = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of catalog.warframes) m.set(f.uniqueName, f.name);
    for (const w of catalog.weapons) m.set(w.uniqueName, w.name);
    return m;
  }, [catalog]);

  useEffect(() => {
    let cancelled = false;
    void loadOverframeLocalBuilds().then((data) => {
      if (cancelled) return;
      setDump(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function reload(soft = false) {
    if (!soft) setLoading(true);
    const data = await loadOverframeLocalBuilds();
    setDump(data);
    setLoading(false);
  }

  useEffect(() => {
    if (!scraping) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/overframe/scrape", {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok || cancelled) return;
        const status = (await res.json()) as {
          state?: string;
          log?: string;
          error?: string;
          item?: string;
        };
        if (status.state === "running") {
          if (status.log) setScrapeLog(status.log.slice(-400));
          return;
        }
        if (status.state === "ok") {
          setScraping(false);
          setScrapeError(null);
          setScrapeLog(
            status.log?.slice(-800) ||
              `ok — ${status.item ?? "dump"} atualizado`,
          );
          await reload(true);
          return;
        }
        if (status.state === "error") {
          setScraping(false);
          setScrapeError(status.error || status.log || "scrape_failed");
          return;
        }
        // idle — still waiting for POST to flip state
      } catch {
        // ignore transient poll errors while Next recovers
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [scraping]);

  async function fetchFromOverframe() {
    const item = scrapeName.trim();
    if (!item) {
      setScrapeError("Digita o nome do frame/arma (ex: Volt Prime)");
      return;
    }
    setScraping(true);
    setScrapeError(null);
    setScrapeLog("Iniciando scrape… Chrome pode abrir (CF).");
    try {
      const res = await fetch("/api/overframe/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item,
          category: scrapeCategory(category),
          limit: scrapeLimit,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json();
      if (res.status === 409) {
        setScrapeLog("Já tem scrape rodando — acompanhando…");
        return;
      }
      if (!res.ok) {
        throw new Error(
          typeof body.message === "string"
            ? body.message
            : typeof body.error === "string"
              ? body.error
              : `HTTP ${res.status}`,
        );
      }
      setScrapeLog("Buscando… (poll). Resolve CF no Chrome se aparecer.");
    } catch (err) {
      setScraping(false);
      setScrapeError(err instanceof Error ? err.message : "Scrape failed");
    }
  }

  const filtered = useMemo(() => {
    let builds = dump?.builds ?? [];
    if (category !== "all") {
      builds = builds.filter(
        (b) => (b.category ?? dump?.category) === category,
      );
    }
    if (ownedItemsOnly && itemFilter) {
      builds = builds.filter((b) => b.itemUniqueName === itemFilter);
    } else if (ownedItemsOnly && owned) {
      const have = new Set([
        ...owned.warframes.map((f) => f.uniqueName),
        ...owned.weapons.map((w) => w.uniqueName),
      ]);
      builds = builds.filter(
        (b) => b.itemUniqueName && have.has(b.itemUniqueName),
      );
    }
    const q = query.trim().toLowerCase();
    if (q) {
      builds = builds.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.itemName ?? "").toLowerCase().includes(q) ||
          b.itemSlug.toLowerCase().includes(q),
      );
    }
    const scored = builds.map((b) => ({
      build: b,
      craft: scoreOverframeBuild(b, owned),
    }));
    const visible =
      minCraft <= 0
        ? scored
        : scored.filter((row) => row.craft.pct >= minCraft);
    visible.sort((a, b) => b.build.votes - a.build.votes);
    return visible;
  }, [
    dump,
    category,
    ownedItemsOnly,
    itemFilter,
    owned,
    query,
    minCraft,
  ]);

  const scrapeBox = (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium tracking-tight">Buscar no Overframe</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Digita o frame/arma. Abre Chrome local (CF se precisar). Faz merge no
          dump — não apaga outros itens.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={scrapeName}
          onChange={(e) => setScrapeName(e.target.value)}
          placeholder='Ex: Volt Prime, Nataruk, Laetum…'
          className="max-w-sm bg-transparent"
          disabled={scraping}
          onKeyDown={(e) => {
            if (e.key === "Enter") void fetchFromOverframe();
          }}
        />
        <select
          value={scrapeLimit}
          onChange={(e) => setScrapeLimit(Number(e.target.value))}
          className="h-8 rounded-md border border-border bg-muted px-2 text-sm text-foreground"
          disabled={scraping}
        >
          <option value={10}>10 builds</option>
          <option value={20}>20 builds</option>
          <option value={30}>30 builds</option>
        </select>
        <Button size="sm" onClick={() => void fetchFromOverframe()} disabled={scraping}>
          {scraping ? "Buscando… (pode abrir Chrome)" : "Buscar"}
        </Button>
      </div>
      {ownedItemOptions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ownedItemOptions.slice(0, 8).map((o) => (
            <button
              key={o.uniqueName}
              type="button"
              className="rounded-md border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => {
                setScrapeName(o.name);
                onItemFilterChange(o.uniqueName);
              }}
              disabled={scraping}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
      {scrapeError && (
        <p className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
          {scrapeError}
        </p>
      )}
      {scrapeLog && !scrapeError && (
        <p className="whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
          {scrapeLog}
        </p>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {scrapeBox}
        <p className="py-6 text-center text-sm text-muted-foreground">
          Loading Overframe dump…
          <span className="mt-1 block text-xs">
            Se travar: reinicia `npm run dev` (scrape longo trava o Next).
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {scrapeBox}

      {!dump?.builds?.length ? (
        <Alert className="border-border bg-muted/30">
          <AlertTitle className="font-mono text-xs tracking-wide uppercase">
            Dump vazio
          </AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            Usa o campo acima pra puxar builds. Primeira vez pode pedir captcha
            no Chrome.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Local dump · {dump.count} builds
              {dump.fetchedAt ? ` · fetched ${dump.fetchedAt}` : ""}
            </p>
            <Button size="sm" variant="outline" onClick={() => void reload(true)}>
              Reload
            </Button>
          </div>

          <div className="flex flex-wrap gap-1">
            {CATS.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={category === c.id ? "default" : "ghost"}
                onClick={() => onCategoryChange(c.id)}
              >
                {c.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar lista…"
              className="max-w-sm bg-transparent"
            />
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
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={ownedItemsOnly}
                onCheckedChange={(v) => onOwnedItemsOnlyChange(Boolean(v))}
                disabled={!owned}
              />
              Only my item
            </label>
            <select
              value={itemFilter}
              onChange={(e) => {
                const value = e.target.value;
                onItemFilterChange(value);
                const name = nameByUn.get(value);
                if (name) setScrapeName(name);
              }}
              className="h-8 max-w-xs rounded-md border border-border bg-muted px-2 text-sm text-foreground disabled:opacity-50"
              disabled={!owned}
            >
              <option value="">
                {ownedItemsOnly
                  ? ownedItemOptions.length
                    ? "Select an owned item…"
                    : "Nothing owned in this category"
                  : "Any owned item (broad)"}
              </option>
              {ownedItemOptions.map((o) => (
                <option key={o.uniqueName} value={o.uniqueName}>
                  {o.name} ({o.kind})
                </option>
              ))}
            </select>
          </div>

          <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {filtered.length} shown
          </p>

          <ul className="divide-y divide-border">
            {filtered.map(({ build, craft }) => (
              <OverframeRow
                key={build.id}
                build={build}
                craftPct={craft.pct}
                craft={craft}
                open={expanded === build.id}
                onToggle={() =>
                  setExpanded((cur) => (cur === build.id ? null : build.id))
                }
              />
            ))}
            {filtered.length === 0 && (
              <li className="py-12 text-center text-sm text-muted-foreground">
                Nada nessa filtro — busca outro item acima.
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function OverframeRow({
  build,
  craftPct,
  craft,
  open,
  onToggle,
}: {
  build: OverframeLocalBuild;
  craftPct: number;
  craft: ReturnType<typeof scoreOverframeBuild>;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onToggle}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium tracking-tight">{build.title}</span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {build.itemName ?? build.itemSlug}
            </Badge>
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {build.votes} votes · {build.formas} forma ·{" "}
            {build.partsCount ?? build.parts?.length ?? 0} parts
          </p>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge
            variant="secondary"
            className={cn(
              "font-mono tabular-nums",
              craftPct === 100 && "bg-foreground text-background",
            )}
          >
            {craftPct}%
          </Badge>
          <a
            href={build.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
          >
            Overframe ↗
          </a>
        </div>
      </div>
      <Progress value={craftPct} className="mt-2 h-1 max-w-md" />
      {open && (
        <div className="mt-3 space-y-2 rounded-md border border-border p-3">
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            {craft.owned}/{craft.total} ok
            {craft.underleveled.length
              ? ` · ${craft.underleveled.length} low rank`
              : ""}
          </p>
          {craft.missing.length > 0 ? (
            <ul className="grid gap-1 sm:grid-cols-2">
              {craft.missing.map((m) => (
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
              You meet every listed mod/arcane at required rank.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
