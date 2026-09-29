"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildCategorizedLists,
  buildCsv,
  exportScopeSlug,
  type ExportScope,
} from "@/lib/inventory";
import type { Catalog, OwnedSnapshot } from "@/lib/types";

const SECTIONS: { id: ExportScope; label: string }[] = [
  { id: "mods", label: "Mods" },
  { id: "weapons", label: "Weapons" },
  { id: "warframes", label: "Warframes" },
  { id: "arcanes", label: "Arcanes" },
  { id: "resources", label: "Resources" },
];

const FORMATS = ["json", "csv", "xlsx"] as const;
type ExportFormat = (typeof FORMATS)[number];

type Props = {
  catalog: Catalog;
  owned: OwnedSnapshot | null;
};

export function ExportDialog({ catalog, owned }: Props) {
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<ExportScope[]>(
    SECTIONS.map((s) => s.id),
  );
  const [format, setFormat] = useState<ExportFormat>("json");
  const [copied, setCopied] = useState(false);

  const empty = sections.length === 0;
  const slug = exportScopeSlug(sections);

  function toggleSection(id: ExportScope) {
    setSections((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
    setCopied(false);
  }

  function selectFormat(next: ExportFormat) {
    setFormat(next);
    setCopied(false);
  }

  function download() {
    if (!owned || empty) return;
    if (format === "xlsx") {
      void import("@/lib/xlsx").then(({ downloadInventoryXlsx }) =>
        downloadInventoryXlsx(catalog, owned, sections),
      );
      return;
    }
    const body =
      format === "json"
        ? JSON.stringify(buildCategorizedLists(catalog, owned, sections), null, 2)
        : buildCsv(catalog, owned, sections);
    const blob = new Blob([body], {
      type: format === "json" ? "application/json" : "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory_${slug}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    if (!owned || empty) return;
    await navigator.clipboard.writeText(
      JSON.stringify(buildCategorizedLists(catalog, owned, sections), null, 2),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!owned}
      >
        Export…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="tracking-tight">
              Export inventory
            </DialogTitle>
            <DialogDescription>
              {empty ? (
                "Select at least one section to export."
              ) : (
                <>
                  Choose what and how to export — file{" "}
                  <span className="font-mono">
                    inventory_{slug}.{format}
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                Include
              </p>
              <div className="flex flex-wrap gap-1">
                {SECTIONS.map((s) => (
                  <Button
                    key={s.id}
                    size="sm"
                    variant={sections.includes(s.id) ? "default" : "ghost"}
                    onClick={() => toggleSection(s.id)}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                Format
              </p>
              <div className="flex flex-wrap gap-1">
                {FORMATS.map((f) => (
                  <Button
                    key={f}
                    size="sm"
                    variant={format === f ? "default" : "ghost"}
                    onClick={() => selectFormat(f)}
                  >
                    {f.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void copy()}
              disabled={empty}
            >
              {copied ? "Copied" : "Copy JSON"}
            </Button>
            <Button onClick={download} disabled={empty}>
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
