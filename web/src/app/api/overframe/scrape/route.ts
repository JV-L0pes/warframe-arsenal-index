import { NextResponse } from "next/server";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = new Set([
  "warframes",
  "primary",
  "secondary",
  "melee",
  "archwing",
  "sentinels",
]);

function scrapeAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" || process.env.ARSENAL_SCRAPE === "1"
  );
}

type ScrapeStatus = {
  state: "idle" | "running" | "ok" | "error";
  item?: string;
  category?: string;
  limit?: number;
  startedAt?: string;
  finishedAt?: string;
  log?: string;
  error?: string;
  pid?: number;
};

let activeChild: ChildProcess | null = null;

function resolvePython(): string {
  return process.env.PYTHON_PATH || process.env.PYTHON || "python";
}

function repoRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), "..");
}

function statusPath(): string {
  return path.join(repoRoot(), "scripts", "data", "overframe_scrape_status.json");
}

function readStatus(): ScrapeStatus {
  try {
    const raw = fs.readFileSync(statusPath(), "utf8");
    return JSON.parse(raw) as ScrapeStatus;
  } catch {
    return { state: "idle" };
  }
}

function writeStatus(status: ScrapeStatus): void {
  const dir = path.dirname(statusPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statusPath(), JSON.stringify(status, null, 2) + "\n", "utf8");
}

export async function GET() {
  const status = readStatus();
  // If file says running but process died (hot reload / crash), heal state
  if (status.state === "running" && activeChild == null) {
    const healed: ScrapeStatus = {
      ...status,
      state: "error",
      finishedAt: new Date().toISOString(),
      error:
        status.error ||
        "Scrape process lost (dev server reload?). Run it again or use the CLI.",
    };
    writeStatus(healed);
    return NextResponse.json(healed);
  }
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  if (!scrapeAllowed()) {
    return NextResponse.json(
      {
        error: "scrape_disabled",
        message:
          "Scrape only runs in the local dev server. Set ARSENAL_SCRAPE=1 to allow it.",
      },
      { status: 403 },
    );
  }

  let body: {
    item?: string;
    category?: string;
    limit?: number;
    headless?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const item = typeof body.item === "string" ? body.item.trim() : "";
  if (!item || item.length > 80) {
    return NextResponse.json(
      { error: 'Pass an item, e.g. "Volt Prime"' },
      { status: 400 },
    );
  }

  if (activeChild) {
    return NextResponse.json(
      {
        error: "already_running",
        message: "A scrape is already running. Wait for it to finish.",
        status: readStatus(),
      },
      { status: 409 },
    );
  }

  const category =
    typeof body.category === "string" && CATEGORIES.has(body.category)
      ? body.category
      : "warframes";
  const limitRaw = Number(body.limit ?? 20);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(40, Math.max(5, Math.floor(limitRaw)))
    : 20;
  const headless = Boolean(body.headless);

  const script = path.join(repoRoot(), "scripts", "fetch_overframe_builds.py");
  const args = [
    script,
    "--item",
    item,
    "--category",
    category,
    "--limit",
    String(limit),
    "--merge",
  ];
  if (headless) args.push("--headless");

  const startedAt = new Date().toISOString();
  const python = resolvePython();

  let stdout = "";
  let stderr = "";

  const child = spawn(/* turbopackIgnore: true */ python, args, {
    cwd: path.join(repoRoot(), "scripts"),
    env: { ...process.env, PYTHONUTF8: "1" },
    windowsHide: false,
    // Don't block the HTTP response — UI polls GET /status
    stdio: ["ignore", "pipe", "pipe"],
  });
  activeChild = child;

  writeStatus({
    state: "running",
    item,
    category,
    limit,
    startedAt,
    pid: child.pid,
    log: "",
  });

  child.stdout?.on("data", (d: Buffer) => {
    stdout += d.toString("utf8");
    if (stdout.length > 8000) stdout = stdout.slice(-6000);
  });
  child.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString("utf8");
    if (stderr.length > 12000) stderr = stderr.slice(-8000);
    writeStatus({
      state: "running",
      item,
      category,
      limit,
      startedAt,
      pid: child.pid,
      log: stderr.slice(-2000),
    });
  });

  child.on("error", (err) => {
    activeChild = null;
    writeStatus({
      state: "error",
      item,
      category,
      limit,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: err.message,
      log: stderr.slice(-2000),
    });
  });

  child.on("close", (code) => {
    activeChild = null;
    const log = (stderr || stdout).slice(-2000);
    if (code === 0) {
      writeStatus({
        state: "ok",
        item,
        category,
        limit,
        startedAt,
        finishedAt: new Date().toISOString(),
        log,
      });
    } else {
      writeStatus({
        state: "error",
        item,
        category,
        limit,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: log || `exit ${code}`,
        log,
      });
    }
  });

  return NextResponse.json({
    started: true,
    item,
    category,
    limit,
    status: readStatus(),
  });
}
