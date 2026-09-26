import { ArsenalApp } from "@/components/arsenal-app";
import type { Catalog, OwnedSnapshot } from "@/lib/types";
import { enrichOwnedSnapshot, isOwnedSnapshot } from "@/lib/inventory";
import { readFile } from "fs/promises";
import path from "path";

async function loadJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const dataDir = path.join(process.cwd(), "public", "data");

// Memoized per server process: these files only change via rebuild/import.
const catalogPromise = loadJson<Catalog>(path.join(dataDir, "catalog.json"));
const ownedPromise = loadJson<unknown>(path.join(dataDir, "owned.json"));

export default async function Home() {
  const [catalog, ownedRaw] = await Promise.all([
    catalogPromise,
    ownedPromise,
  ]);

  if (!catalog) {
    return (
      <main className="p-8 font-mono text-sm text-muted-foreground">
        catalog.json missing — rode{" "}
        <code className="text-foreground">python scripts/build_catalog.py</code>
      </main>
    );
  }

  const initialOwned: OwnedSnapshot | null = isOwnedSnapshot(ownedRaw)
    ? enrichOwnedSnapshot(ownedRaw)
    : null;

  return <ArsenalApp catalog={catalog} initialOwned={initialOwned} />;
}
