# Arsenal Index — Warframe

Local-first Warframe arsenal browser. Black & white. No accounts. No telemetry.

Cross-check the full Public Export catalog (mods, weapons, warframes) against **your** inventory dump, then export categorized JSON lists.

**Unofficial. Not affiliated with Digital Extremes.**

---

## Features

- Full mod catalog by class (rifle, shotgun, pistol, melee, warframe, aura, stance, …)
- Owned / missing filters + search
- Import `inventory_raw.json` from the Linux fetch script
- Export / copy categorized lists (`mods_rifle`, `primary_bow`, `warframes`, …)
- Personal inventory never committed (`owned.json` / raw dumps gitignored)

## Stack

| Layer | Tech |
|-------|------|
| UI | Next.js · shadcn/ui · Tailwind · IBM Plex |
| Catalog | Warframe Public Export |
| Inventory | Unofficial mobile API + memory token (Linux / Proton) |

## Quick start

### Web

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000

### Fetch inventory (Linux)

Warframe must be running and logged in.

```bash
# if /proc/PID/mem is blocked:
sudo sysctl kernel.yama.ptrace_scope=0

cd scripts
python3 export.py
```

In the UI: **Import JSON** → `scripts/data/inventory_raw.json`

### Export lists

**Export lists** / **Copy JSON**:

```json
{
  "mods_rifle": ["Serration r10", "Split Chamber r5"],
  "mods_shotgun": ["Point Blank r10"],
  "warframes": ["Saryn Prime", "Mesa Prime"],
  "primary_bow": ["Nataruk"]
}
```

## Rebuild catalog

```bash
cd scripts
python3 categorize.py          # refresh Public Export cache
python3 build_catalog.py       # writes web/public/data/catalog.json
```

Catalog embeds `generatedAt`, source, and applied filters (skips PvP / Beginner / Expert / Rivens). Weapon subtypes prefer [warframestat.us](https://warframestat.us) `type` matched by `uniqueName`, with Export/heuristics as fallback.

## Data reliability

| Source | Trust | Notes |
|--------|-------|-------|
| `uniqueName` match | High | Stable DE item IDs — ownership is keyed on these, not display names |
| Public Export names | High | Official DE dump; rebuild after major patches |
| Weapon subtype (WFCD) | High | warframestat `type` (Rifle / Shotgun / Bow / …) |
| Inventory dump | High *if fresh* | Snapshot at fetch/import — UI marks **stale** after 7 days |
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
