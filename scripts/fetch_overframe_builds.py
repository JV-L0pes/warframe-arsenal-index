#!/usr/bin/env python3
"""Scrape Overframe community builds with Playwright (no public API).

Overframe has an internal Django API but it is not public; Cloudflare also
blocks plain HTTP clients. This script opens a real Chromium window so you can
pass the challenge once, then dumps builds + resolved mod uniqueNames.

Examples:
  python fetch_overframe_builds.py --category warframes --item "Volt Prime" --limit 20
  python fetch_overframe_builds.py --category warframes --item "Volt Prime" --sort Score --patch 0
  python fetch_overframe_builds.py --headed --limit 10

Default list filters: sort=Updated + patch=latest (avoids ancient high-vote builds).

Requires: pip install playwright && playwright install chromium
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
OUT_SCRIPTS = ROOT / "data" / "overframe_builds.json"
OUT_WEB = REPO / "web" / "public" / "data" / "overframe_builds.json"
CSV_PATH = REPO / "web" / "public" / "data" / "overframe-items.csv"
CATALOG_PATH = REPO / "web" / "public" / "data" / "catalog.json"
BROWSER_PROFILE = ROOT / "data" / "overframe_browser_profile"

CATEGORY_PATHS = {
    "warframes": "warframes",
    "primary": "primary-weapons",
    "secondary": "secondary-weapons",
    "melee": "melee-weapons",
    "archwing": "archwing",
    "sentinels": "sentinels",
}

BUILD_HREF_RE = re.compile(
    r'href="(/build/(\d+)/([^/]+)/([^/]+)/)"',
    re.I,
)


def normalize_name(name: str) -> str:
    name = re.sub(r"<[^>]+>", "", name or "")
    name = re.sub(r"[^a-z0-9]+", " ", name.lower())
    return name.strip()


def load_id_to_name(csv_path: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    if not csv_path.exists():
        print(f"warn: missing {csv_path} — run fetch_overframe_items.py", file=sys.stderr)
        return mapping
    for line in csv_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.lower().startswith("id,"):
            continue
        comma = line.index(",")
        oid = line[:comma].strip().strip('"')
        name = line[comma + 1 :].strip().strip('"').replace('""', '"')
        if oid and name:
            mapping[oid] = name
    return mapping


def resolve_overframe_item_id(item_query: str, id_to_name: dict[str, str]) -> str | None:
    """Best Overframe numeric id for a display name (prefer exact, skip parts)."""
    q = normalize_name(item_query)
    if not q:
        return None
    exact: list[tuple[str, str]] = []
    partial: list[tuple[str, str]] = []
    skip = ("chassis", "neuroptics", "systems", "barrel", "receiver", "stock", "grip", "link")
    for oid, name in id_to_name.items():
        nn = normalize_name(name)
        if any(s in nn.split() for s in skip) and nn != q:
            # allow exact "volt prime" only; skip component rows unless query asks
            if not q.endswith(tuple(skip)):
                continue
        if nn == q:
            exact.append((oid, name))
        elif q in nn or nn in q:
            partial.append((oid, name))
    pool = exact or partial
    if not pool:
        return None
    # Prefer shorter names (base item over "X Prime Foo")
    pool.sort(key=lambda t: (len(t[1]), int(t[0]) if t[0].isdigit() else 10**9))
    return pool[0][0]


def load_name_index(catalog_path: Path) -> dict[str, str]:
    index: dict[str, str] = {}
    if not catalog_path.exists():
        print(f"warn: missing {catalog_path}", file=sys.stderr)
        return index
    cat = json.loads(catalog_path.read_text(encoding="utf-8"))
    for key in ("mods", "arcanes", "warframes", "weapons"):
        for row in cat.get(key) or []:
            un = row.get("uniqueName")
            name = row.get("name")
            if un and name:
                index[normalize_name(name)] = un
    return index


def is_cloudflare_challenge(page) -> bool:
    title = (page.title() or "").lower()
    try:
        content = page.content()[:4000].lower()
    except Exception:
        content = ""
    if "just a moment" in title or "attention required" in title:
        return True
    if "cf-mitigated" in content or "challenge-platform" in content:
        return True
    if "verify you are human" in content or "checking your browser" in content:
        return True
    return False


def page_looks_ready(page) -> bool:
    try:
        if page.query_selector("#__NEXT_DATA__"):
            return True
        if page.query_selector("a[href*='/build/']"):
            return True
        title = (page.title() or "").lower()
        if "overframe" in title and not is_cloudflare_challenge(page):
            return True
    except Exception:
        return False
    return False


def wait_for_cloudflare(page, *, interactive: bool, timeout_s: float = 300) -> None:
    """Wait out CF. Headed runs: solve captcha in the browser window."""
    deadline = time.time() + timeout_s
    prompted = False
    while time.time() < deadline:
        if page_looks_ready(page) and not is_cloudflare_challenge(page):
            return
        if is_cloudflare_challenge(page) and not prompted:
            if interactive:
                print(
                    "\n>>> Cloudflare captcha na janela do browser.\n"
                    ">>> Resolve até a página do Overframe carregar.\n"
                    ">>> Depois volta aqui e aperta ENTER.\n",
                    file=sys.stderr,
                )
                try:
                    input()
                except EOFError:
                    pass
            else:
                print(
                    "\n>>> Cloudflare captcha — resolve na janela do Chrome "
                    "(o script espera até 5 min).\n",
                    file=sys.stderr,
                )
            prompted = True
            if page_looks_ready(page) and not is_cloudflare_challenge(page):
                return
            page.wait_for_timeout(2000)
            continue
        page.wait_for_timeout(1000)

    if page_looks_ready(page) and not is_cloudflare_challenge(page):
        return
    raise RuntimeError(
        "Cloudflare ainda bloqueando. Rode uma vez no terminal pra salvar o cookie "
        "em scripts/data/overframe_browser_profile."
    )


def extract_next_data(page) -> dict[str, Any] | None:
    raw = page.evaluate(
        """() => {
          const el = document.getElementById('__NEXT_DATA__');
          return el ? el.textContent : null;
        }"""
    )
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def find_first_array(obj: Any, key_name: str) -> list[Any] | None:
    seen: set[int] = set()

    def walk(value: Any) -> list[Any] | None:
        if not isinstance(value, (dict, list)):
            return None
        oid = id(value)
        if oid in seen:
            return None
        seen.add(oid)
        if isinstance(value, list):
            for v in value:
                hit = walk(v)
                if hit is not None:
                    return hit
            return None
        if key_name in value and isinstance(value[key_name], list):
            return value[key_name]
        for v in value.values():
            hit = walk(v)
            if hit is not None:
                return hit
        return None

    return walk(obj)


def find_first_string(obj: Any, pred) -> str | None:
    seen: set[int] = set()

    def walk(value: Any) -> str | None:
        if not isinstance(value, (dict, list)):
            return None
        oid = id(value)
        if oid in seen:
            return None
        seen.add(oid)
        if isinstance(value, list):
            for v in value:
                hit = walk(v)
                if hit:
                    return hit
            return None
        for k, v in value.items():
            if isinstance(v, str) and pred(k, v):
                return v
            hit = walk(v)
            if hit:
                return hit
        return None

    return walk(obj)


def coerce_slots(raw: Any) -> list[tuple[str, int]]:
    if isinstance(raw, dict) and "slots" in raw:
        return coerce_slots(raw["slots"])
    if not isinstance(raw, list):
        return []
    out: list[tuple[str, int]] = []
    for entry in raw:
        if isinstance(entry, (list, tuple)) and len(entry) >= 2:
            oid, rank = str(entry[0]), entry[1]
            if oid and oid != "0" and isinstance(rank, (int, float)):
                out.append((oid, int(rank)))
            continue
        if isinstance(entry, dict):
            oid = entry.get("mod", entry.get("id", entry.get("modId")))
            rank = entry.get("rank", entry.get("level"))
            if oid is None or rank is None:
                continue
            oid_s = str(oid)
            if oid_s and oid_s != "0" and isinstance(rank, (int, float)):
                out.append((oid_s, int(rank)))
    return out


def decode_build_string(s: str) -> Any:
    import base64

    try:
        pad = "=" * ((4 - len(s) % 4) % 4)
        text = base64.urlsafe_b64decode(s.replace("+", "-").replace("/", "_") + pad)
        # sometimes already utf-8 json
        try:
            return json.loads(text.decode("utf-8"))
        except Exception:
            return json.loads(s)
    except Exception:
        try:
            return json.loads(s)
        except Exception:
            return None


def parts_from_next_data(
    next_data: dict[str, Any],
    id_to_name: dict[str, str],
    name_index: dict[str, str],
) -> list[dict[str, Any]]:
    root = next_data.get("props", {}).get("pageProps", next_data)
    slots = (
        find_first_array(root, "slots")
        or find_first_array(root, "build_slots")
        or find_first_array(root, "mod_slots")
    )
    id_ranks = coerce_slots(slots)
    if not id_ranks:
        build_string = find_first_string(
            root,
            lambda k, v: bool(
                re.search(r"buildstring|build_string|builddata|build_data", k, re.I)
            )
            and len(v) > 20,
        )
        if build_string:
            id_ranks = coerce_slots(decode_build_string(build_string))

    parts: list[dict[str, Any]] = []
    seen: set[str] = set()
    for oid, rank in id_ranks:
        name = id_to_name.get(oid)
        if not name:
            continue
        un = name_index.get(normalize_name(name))
        if not un or un in seen:
            continue
        if "/Powersuits/" in un:
            continue
        if "/Weapons/" in un and "/Upgrades/" not in un:
            continue
        seen.add(un)
        kind = "arcane" if "/CosmeticEnhancers/" in un else "mod"
        parts.append(
            {
                "uniqueName": un,
                "name": name,
                "kind": kind,
                "rank": rank,
            }
        )
    return parts


def parse_list_html(html: str, *, preserve_order: bool = False) -> list[dict[str, Any]]:
    builds: list[dict[str, Any]] = []
    seen: set[str] = set()
    for m in BUILD_HREF_RE.finditer(html):
        path, bid, item_slug, title_slug = m.group(1), m.group(2), m.group(3), m.group(4)
        if bid in seen:
            continue
        seen.add(bid)
        chunk = html[m.start() : m.start() + 2500]
        votes_m = re.search(r">(\d+)</dd>", chunk) or re.search(
            r"buildVotes[^>]*>.*?(\d+)", chunk, re.I | re.S
        )
        forma_m = re.search(r"(\d+)\s*(?:<!-- -->)?\s*Forma", chunk, re.I)
        title_m = re.search(r"<h3[^>]*>([^<]+)</h3>", chunk, re.I)
        builds.append(
            {
                "id": bid,
                "url": f"https://overframe.gg{path}",
                "itemSlug": item_slug,
                "titleSlug": title_slug,
                "title": (title_m.group(1).strip() if title_m else title_slug.replace("-", " ")),
                "votes": int(votes_m.group(1)) if votes_m else 0,
                "formas": int(forma_m.group(1)) if forma_m else 0,
            }
        )
    if not preserve_order:
        builds.sort(key=lambda b: b["votes"], reverse=True)
    return builds


def build_list_query(*, sort: str, patch: str) -> str:
    """Overframe list query: ?sort=Updated&patch=43"""
    params: list[str] = []
    if sort and sort != "Score":
        params.append(f"sort={sort}")
    if patch and patch not in ("0", "any", "all"):
        # "latest" resolved after page load from the Updated-since select
        if patch.lower() != "latest":
            params.append(f"patch={patch}")
    return ("?" + "&".join(params)) if params else ""


def apply_list_filters(page, *, sort: str, patch: str) -> dict[str, Any]:
    """Drive Overframe Sort + Updated-since selects (works after SPA hydrate)."""
    return page.evaluate(
        """({ sort, patch }) => {
          const sels = [...document.querySelectorAll('select')];
          if (!sels.length) return { ok: false, reason: 'no-select', patch: null, href: location.href };
          const sortSel = sels.find(s =>
            [...s.options].some(o => o.value === 'Updated' || o.value === 'Score')
          );
          const patchSel = sels.find(s =>
            [...s.options].some(o => o.value === '0' && /any\\s*time/i.test(o.textContent || ''))
          );
          if (sortSel && sort) {
            sortSel.value = sort;
            sortSel.dispatchEvent(new Event('input', { bubbles: true }));
            sortSel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          let resolved = patch;
          if (patchSel) {
            const opts = [...patchSel.options];
            if (!resolved || String(resolved).toLowerCase() === 'latest') {
              const latest = opts.find(o => /latest/i.test(o.textContent || ''));
              const first = opts.find(o => o.value && o.value !== '0');
              resolved = latest ? latest.value : (first ? first.value : '0');
            }
            if (resolved && resolved !== '0' && resolved !== 'any') {
              patchSel.value = String(resolved);
              patchSel.dispatchEvent(new Event('input', { bubbles: true }));
              patchSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          return { ok: true, patch: resolved, href: location.href };
        }""",
        {"sort": sort, "patch": patch},
    )


def resolve_item_unique_name(item_slug: str, item_name: str | None, name_index: dict[str, str]) -> str | None:
    candidates = []
    if item_name:
        candidates.append(item_name)
    candidates.append(item_slug.replace("-", " "))
    for c in candidates:
        un = name_index.get(normalize_name(c))
        if un and ("/Powersuits/" in un or "/Weapons/" in un):
            return un
        if un:
            return un
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Scrape Overframe builds via Playwright")
    ap.add_argument(
        "--category",
        default="warframes",
        choices=sorted(CATEGORY_PATHS),
        help="Overframe builds category",
    )
    ap.add_argument(
        "--item",
        default="",
        help='Warframe/weapon name to filter, e.g. "Volt Prime" (recommended)',
    )
    ap.add_argument(
        "--any-item",
        action="store_true",
        help="allow scraping the global top list without --item",
    )
    ap.add_argument("--limit", type=int, default=25, help="max builds to detail-scrape")
    ap.add_argument("--list-limit", type=int, default=80, help="max list entries to consider")
    ap.add_argument(
        "--sort",
        default="Updated",
        choices=["Updated", "Score", "FormaDescending", "FormaAscending", "Name"],
        help="Overframe list sort (default Updated = recent patches, not all-time votes)",
    )
    ap.add_argument(
        "--patch",
        default="latest",
        help='Overframe "Updated since" filter: latest | 43 | 0 (any). Default: latest',
    )
    ap.add_argument("--headed", action="store_true", default=True, help="show browser (default)")
    ap.add_argument("--headless", action="store_true", help="hide browser (often blocked by CF)")
    ap.add_argument(
        "--chromium",
        action="store_true",
        help="force Playwright Chromium instead of installed Chrome",
    )
    ap.add_argument(
        "--fresh-profile",
        action="store_true",
        help="delete saved browser profile (forces new CF challenge)",
    )
    ap.add_argument(
        "--merge",
        action="store_true",
        help="merge into existing overframe_builds.json (keep other items)",
    )
    ap.add_argument(
        "-o",
        "--output",
        type=Path,
        default=OUT_SCRIPTS,
        help="output JSON path",
    )
    args = ap.parse_args()
    headed = not args.headless
    interactive = headed and sys.stdin.isatty()

    if not args.item.strip() and not args.any_item:
        if interactive:
            print(
                'Qual item? Ex: Volt Prime  (Enter vazio = top global)',
                file=sys.stderr,
            )
            try:
                typed = input("> ").strip()
            except EOFError:
                typed = ""
            if typed:
                args.item = typed
            else:
                args.any_item = True
                print("ok — top global da categoria", file=sys.stderr)
        else:
            print(
                'error: passa --item "Volt Prime" (ou --any-item pro top global)',
                file=sys.stderr,
            )
            return 2

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "error: playwright not installed. Run:\n"
            "  pip install playwright\n"
            "  python -m playwright install chromium",
            file=sys.stderr,
        )
        return 1

    id_to_name = load_id_to_name(CSV_PATH)
    name_index = load_name_index(CATALOG_PATH)
    print(f"maps: {len(id_to_name)} overframe ids, {len(name_index)} catalog names", file=sys.stderr)

    list_url = f"https://overframe.gg/builds/{CATEGORY_PATHS[args.category]}/"
    item_filter = normalize_name(args.item) if args.item else ""
    item_id = (
        resolve_overframe_item_id(args.item, id_to_name) if args.item.strip() else None
    )
    if args.item.strip():
        if item_id:
            list_url = f"https://overframe.gg/items/arsenal/{item_id}/"
            print(
                f"item page: {args.item!r} → id={item_id} → {list_url}",
                file=sys.stderr,
            )
        else:
            print(
                f"warn: no Overframe id for {args.item!r}; "
                "falling back to category list + name filter",
                file=sys.stderr,
            )
    list_qs = build_list_query(sort=args.sort, patch=args.patch)
    if list_qs:
        list_url = list_url.rstrip("/") + "/" + list_qs
    print(f"list filters: sort={args.sort} patch={args.patch}", file=sys.stderr)

    if args.fresh_profile and BROWSER_PROFILE.exists():
        import shutil

        shutil.rmtree(BROWSER_PROFILE, ignore_errors=True)
        print("cleared browser profile", file=sys.stderr)

    BROWSER_PROFILE.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        # Installed Chrome + persistent profile survives CF much better than
        # a fresh Chromium context every run.
        launch_kwargs: dict[str, Any] = {
            "user_data_dir": str(BROWSER_PROFILE),
            "headless": not headed,
            "locale": "en-US",
            "viewport": {"width": 1280, "height": 900},
            "args": ["--disable-blink-features=AutomationControlled"],
            "ignore_default_args": ["--enable-automation"],
        }
        if not args.chromium:
            launch_kwargs["channel"] = "chrome"

        try:
            context = p.chromium.launch_persistent_context(**launch_kwargs)
            print(
                "browser: Chrome (persistent profile)"
                if not args.chromium
                else "browser: Chromium (persistent profile)",
                file=sys.stderr,
            )
        except Exception as e:
            if args.chromium:
                raise
            print(
                f"warn: Chrome channel failed ({e}); falling back to Chromium",
                file=sys.stderr,
            )
            launch_kwargs.pop("channel", None)
            context = p.chromium.launch_persistent_context(**launch_kwargs)

        page = context.pages[0] if context.pages else context.new_page()
        # Soften obvious automation fingerprints
        page.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
        )

        print(f"open {list_url}", file=sys.stderr)
        if interactive:
            print(
                "Se aparecer captcha: resolve na janela, depois ENTER neste terminal.",
                file=sys.stderr,
            )
        page.goto(list_url, wait_until="domcontentloaded", timeout=120_000)
        wait_for_cloudflare(page, interactive=interactive)
        page.wait_for_timeout(1500)
        filt = apply_list_filters(page, sort=args.sort, patch=args.patch)
        print(f"applied filters: {filt}", file=sys.stderr)
        page.wait_for_timeout(2500)
        # If patch=latest was resolved, hard-navigate with query so SSR list matches
        resolved_patch = str((filt or {}).get("patch") or args.patch)
        if args.patch.lower() == "latest" and resolved_patch not in ("0", "latest", ""):
            from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

            parts = urlsplit(page.url)
            q = dict(parse_qsl(parts.query, keep_blank_values=True))
            if args.sort and args.sort != "Score":
                q["sort"] = args.sort
            q["patch"] = resolved_patch
            nav = urlunsplit(
                (parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment)
            )
            if nav != page.url:
                print(f"reopen filtered {nav}", file=sys.stderr)
                page.goto(nav, wait_until="domcontentloaded", timeout=120_000)
                wait_for_cloudflare(page, interactive=interactive)
                page.wait_for_timeout(1500)
        html = page.content()
        listed = parse_list_html(html, preserve_order=args.sort != "Score")
        print(f"list hits: {len(listed)}", file=sys.stderr)

        # Name filter only when we could not open the item arsenal page
        if item_filter and not item_id:
            listed = [
                b
                for b in listed
                if item_filter in normalize_name(b["itemSlug"])
                or item_filter in normalize_name(b["title"])
            ]
            print(f"after --item filter: {len(listed)}", file=sys.stderr)
        elif item_filter and item_id:
            # Keep builds whose slug matches; drop unrelated related-builds noise
            matched = [
                b
                for b in listed
                if item_filter in normalize_name(b["itemSlug"])
                or item_filter in normalize_name(b.get("title", ""))
            ]
            if matched:
                listed = matched
                print(f"item-page matches: {len(listed)}", file=sys.stderr)

        listed = listed[: max(1, args.list_limit)]
        targets = listed[: max(1, args.limit)]

        builds_out: list[dict[str, Any]] = []
        for i, summary in enumerate(targets, 1):
            url = summary["url"]
            print(f"[{i}/{len(targets)}] {summary['id']} {summary['title'][:50]}", file=sys.stderr)
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=90_000)
                wait_for_cloudflare(page, interactive=interactive)
                page.wait_for_timeout(1000)
                next_data = extract_next_data(page)
                parts: list[dict[str, Any]] = []
                item_name = summary["itemSlug"].replace("-", " ").title()
                if next_data:
                    parts = parts_from_next_data(next_data, id_to_name, name_index)
                    maybe_name = find_first_string(
                        next_data.get("props", {}).get("pageProps", next_data),
                        lambda k, v: "item" in k.lower()
                        and 1 < len(v) < 80
                        and not v.startswith("http"),
                    )
                    if maybe_name:
                        item_name = maybe_name
                item_un = resolve_item_unique_name(
                    summary["itemSlug"], item_name, name_index
                )
                builds_out.append(
                    {
                        **summary,
                        "itemName": item_name,
                        "itemUniqueName": item_un,
                        "category": args.category,
                        "parts": parts,
                        "partsCount": len(parts),
                    }
                )
            except Exception as e:
                print(f"  warn: {e}", file=sys.stderr)
                builds_out.append({**summary, "parts": [], "partsCount": 0, "error": str(e)})

        context.close()

    payload = {
        "source": "overframe",
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "category": args.category,
        "itemFilter": args.item or None,
        "sort": args.sort,
        "patch": args.patch,
        "count": len(builds_out),
        "builds": builds_out,
    }

    if args.merge and (args.output.exists() or OUT_WEB.exists()):
        src = args.output if args.output.exists() else OUT_WEB
        try:
            prev = json.loads(src.read_text(encoding="utf-8"))
            old_builds = prev.get("builds") or []
        except Exception:
            old_builds = []
        drop_ids = {b["id"] for b in builds_out if b.get("id")}
        drop_items = {
            normalize_name(b.get("itemName") or b.get("itemSlug") or "")
            for b in builds_out
        }
        drop_uns = {b.get("itemUniqueName") for b in builds_out if b.get("itemUniqueName")}
        kept = []
        for b in old_builds:
            if b.get("id") in drop_ids:
                continue
            if b.get("itemUniqueName") and b.get("itemUniqueName") in drop_uns:
                continue
            key = normalize_name(b.get("itemName") or b.get("itemSlug") or "")
            if key and key in drop_items:
                continue
            kept.append(b)
        merged = kept + builds_out
        merged.sort(key=lambda b: int(b.get("votes") or 0), reverse=True)
        payload["builds"] = merged
        payload["count"] = len(merged)
        payload["itemFilter"] = args.item or prev.get("itemFilter")
        print(f"merge: kept {len(kept)} + new {len(builds_out)} = {len(merged)}", file=sys.stderr)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    # Mirror into Next public data for the UI
    OUT_WEB.parent.mkdir(parents=True, exist_ok=True)
    OUT_WEB.write_text(args.output.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"wrote {args.output}", file=sys.stderr)
    print(f"wrote {OUT_WEB}", file=sys.stderr)
    ok = sum(1 for b in builds_out if b.get("partsCount"))
    print(f"builds with parts: {ok}/{len(builds_out)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
