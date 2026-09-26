import { Badge } from "@/components/ui/badge";
import type { Craftability } from "@/lib/craftability";
import { cn } from "@/lib/utils";

export const MIN_CRAFT = [
  { id: 0, label: "Any %" },
  { id: 50, label: "≥50%" },
  { id: 80, label: "≥80%" },
  { id: 100, label: "100%" },
] as const;

export function CraftBadge({ pct }: { pct: number | null }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "font-mono tabular-nums",
        pct === 100 && "bg-foreground text-background",
      )}
    >
      {pct === null ? "—" : `${pct}%`}
    </Badge>
  );
}

export function CraftDetails({ craft }: { craft: Craftability }) {
  return (
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
  );
}
