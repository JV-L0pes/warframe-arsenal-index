import { ArsenalApp } from "@/components/arsenal-app";
import type { Catalog, OwnedSnapshot } from "@/lib/types";
import { isOwnedSnapshot } from "@/lib/inventory";
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

export default async function Home() {
  const dataDir = path.join(process.cwd(), "public", "data");
  const catalog = (await loadJson<Catalog>(path.join(dataDir, "catalog.json")))!;
  const ownedRaw = await loadJson<unknown>(path.join(dataDir, "owned.json"));
  const initialOwned: OwnedSnapshot | null = isOwnedSnapshot(ownedRaw)
    ? ownedRaw
    : null;

  return <ArsenalApp catalog={catalog} initialOwned={initialOwned} />;
}
