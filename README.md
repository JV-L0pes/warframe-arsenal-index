# Arsenal Index — Warframe

Local-first Warframe arsenal browser. Black & white. No accounts. No telemetry.

Cross-check the full Public Export catalog (mods, weapons, warframes, arcanes) against **your** inventory dump, then export it as JSON, CSV or XLSX.

**Unofficial. Not affiliated with Digital Extremes.**

---

## Features

- Full mod catalog by class (rifle, shotgun, pistol, melee, warframe, aura, stance, …)
- Owned / missing filters + search
- Import `inventory_raw.json` from the fetch script (Windows / Linux)
- Export / copy categorized lists (`mods_rifle`, `primary_bow`, `warframes`, …)
- Export CSV of owned inventory (mods, arcanes, weapons, warframes) for spreadsheets
- Export XLSX (native spreadsheet) of the same data
- Personal inventory never committed (`owned.json` / raw dumps gitignored)

## Stack

| Layer | Tech |
|-------|------|
| UI | Next.js · shadcn/ui · Tailwind · IBM Plex |
| Catalog | Warframe Public Export |
| Inventory | Unofficial mobile API + memory token (Linux / Windows) |

## Quick start

### Web

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000

### Fetch inventory

Warframe must be running and logged in.

**Windows** (PowerShell / cmd — run as Administrator if OpenProcess fails):

```powershell
cd scripts
python export.py
```

**Linux** (Proton / native):

```bash
# if /proc/PID/mem is blocked:
sudo sysctl kernel.yama.ptrace_scope=0

cd scripts
python3 export.py
```

In the UI: **Import JSON** → `scripts/data/inventory_raw.json`

### Export lists

**Export lists** / **Copy JSON** — owned items with status:

```json
{
  "mods_rifle": ["Serration", "Split Chamber"],
  "primary_bow": [
    {
      "name": "Nataruk",
      "rank": 30,
      "polarized": 2,
      "masteryDone": true,
      "mastery": "done"
    }
  ],
  "warframes": [
    {
      "name": "Saryn Prime",
      "rank": 9,
      "polarized": 3,
      "masteryDone": true,
      "mastery": "done"
    }
  ]
}
```

Mods export as **name strings only**. Weapons/warframes keep rank · Forma · mastery status.

**Export CSV** / **Export XLSX** flatten the active section (all sections on first load) with columns `type, name, group, subtype, rank, count, polarized, mastery`.

## Rebuild catalog

```bash
# downloads Public Export + warframestat + WFCD arcanes, writes web/public/data/catalog.json
python scripts/build_catalog.py --refresh
# Linux: python3 scripts/build_catalog.py --refresh
```

### CI (no cloud host)

GitHub Actions refreshes the catalog automatically:

| Trigger | When |
|---------|------|
| Cron | Mondays 06:00 UTC |
| Manual | Actions → **Refresh catalog** → Run workflow |
| Push | changes to `scripts/build_catalog.py` |

Workflow: [`.github/workflows/refresh-catalog.yml`](.github/workflows/refresh-catalog.yml)  
It re-fetches DE Public Export + warframestat, validates counts, and commits `catalog.json` only if it changed. Inventory dumps stay local (never in CI).

Quality checks run on every push/PR via [`.github/workflows/ci.yml`](.github/workflows/ci.yml): ESLint, `tsc`, unit tests (Vitest + Python `unittest`), `next build` and `npm audit --audit-level=high`.

## Data reliability

| Source | Trust | Notes |
|--------|-------|-------|
| `uniqueName` match | High | Stable DE item IDs — ownership is keyed on these, not display names |
| Public Export names | High | Official DE dump; rebuild after major patches |
| Weapon subtype (WFCD) | High | warframestat `type` (Rifle / Shotgun / Bow / …) |
| Inventory dump | High *if fresh* | Snapshot at fetch/import — UI marks **stale** after 7 days |
| Mod copy count | High | `RawUpgrades` (unranked stacks) + `Upgrades` (ranked instances) are disjoint pools and are summed per `uniqueName` |
| Heuristic subtype leftover | Low | Only when WFCD has no `uniqueName` |

**Guarantees we keep:**

- Personal dumps stay local (gitignored)
- Import validates shape before applying
- Catalog timestamp + inventory sync age in the UI
- First-run disclaimer for memory/token fetch risk
- No cloud sync of inventory

**Not guaranteed:** DE schema changes, ToS of memory/token fetch, 100% coverage when WFCD lags a patch.

## Layout

```
scripts/                 fetch + categorize + build_catalog
web/                     Arsenal Index UI
web/public/data/
  catalog.json           committed (game data only)
  owned.example.json     empty sample
  owned.json             gitignored
```

## Disclaimer

Inventory fetch reads the Warframe process memory and calls an unofficial API. Use at your own risk.
