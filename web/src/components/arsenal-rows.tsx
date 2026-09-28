import { cn } from "@/lib/utils";
import { polarityLabel } from "@/lib/types";

type ItemProgress = {
  rank: number | null;
  count?: number;
};

type GearProgress = {
  rank?: number;
  polarized?: number;
  masteryDone?: boolean;
};

function OwnedDot({ owned }: { owned: boolean }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        owned ? "bg-foreground" : "bg-border",
      )}
    />
  );
}

export function ItemRow({
  name,
  owned,
  polarity,
  rarity,
  isAugment,
  compatName,
  variant = "mod",
}: {
  name: string;
  owned?: ItemProgress;
  polarity?: string;
  rarity?: string;
  isAugment?: boolean;
  compatName?: string;
  variant?: "mod" | "arcane";
}) {
  const isMod = variant === "mod";
  return (
    <li
      className={cn(
        "grid grid-cols-[1fr_auto] items-center gap-3 px-2 py-2.5",
        isMod
          ? "md:grid-cols-[1fr_100px_90px_70px]"
          : "md:grid-cols-[1fr_90px_70px]",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <OwnedDot owned={Boolean(owned)} />
          <span
            className={cn(
              "truncate text-sm",
              owned ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {name}
          </span>
          {isAugment && (
            <span className="font-mono text-[10px] text-muted-foreground">
              AUG
            </span>
          )}
        </div>
        {compatName && (
          <p className="mt-0.5 truncate pl-3.5 font-mono text-[10px] text-muted-foreground">
            {compatName}
          </p>
        )}
      </div>
      {isMod && (
        <span className="hidden font-mono text-[11px] text-muted-foreground md:block">
          {polarityLabel(polarity)}
        </span>
      )}
      <span className="hidden font-mono text-[11px] text-muted-foreground uppercase md:block">
        {rarity?.toLowerCase() ?? "—"}
      </span>
      <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {owned
          ? `r${owned.rank ?? "—"}` +
            ((owned.count ?? 0) > 1 ? ` ×${owned.count}` : "")
          : "—"}
      </span>
    </li>
  );
}

export function GearRow({
  name,
  owned,
  subtype,
  mastered,
}: {
  name: string;
  owned?: GearProgress;
  subtype?: string;
  /** Lifetime mastery done per XPInfo, even when the item is no longer owned */
  mastered?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-2 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <OwnedDot owned={Boolean(owned)} />
        <span
          className={cn(
            "truncate text-sm",
            owned ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {name}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
        {owned && (
          <>
            <span className="tabular-nums">r{owned.rank ?? 0}</span>
            {(owned.polarized ?? 0) > 0 && (
              <span title="Forma applied">★{owned.polarized}</span>
            )}
            {owned.masteryDone ? (
              <span
                className="text-foreground/80"
                title="Ranks 1–30 mastery already claimed — releveling won't give more MR XP"
              >
                mastery done
              </span>
            ) : (
              <span title="Still earns Mastery Rank XP">MR open</span>
            )}
          </>
        )}
        {!owned && mastered && (
          <span
            className="text-foreground/80"
            title="Mastery already claimed before it was sold — rebuilding it won't give more MR XP"
          >
            mastery done
          </span>
        )}
        {subtype && <span className="capitalize opacity-70">{subtype}</span>}
      </div>
    </li>
  );
}
