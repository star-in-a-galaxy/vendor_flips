# WoW Forever · Vendor Flip Calculator

A static [GitHub Pages](https://pages.github.com) web app that ranks every crafting recipe in
**World of Warcraft: Forever** by profit — per craft and per hour — so you can find the vendor flips,
AH flips, and gold-makers worth your time.

It answers: *"is it worth buying these materials and crafting this, and how fast does it pay?"*

## Features

- **2,051 item-crafting recipes** across all 12 professions (Alchemy, Blacksmithing, Enchanting, Engineering,
  Leatherworking, Tailoring, Cooking, First Aid, Mining, Herbalism, Skinning, Fishing), each with its
  reagents, output, craft (cast) time, cooldown, and skill thresholds. Service-only enchantments are omitted.
- **Vendor material prices pre-loaded** for the fixed vendor-sold materials (thread, dyes, vials, flux,
  salt, spices, rods, wood, frameworks, blasting powder, etc.) — the "base" price before any discount.
- **Reputation discount** — Classic behaviour: 0% at Neutral/Friendly, **10% at Honored (cap)**.
- **Legacy Bartering** — the Professions-tree Legacy perk: 0, 5%, or 10% off vendor buy prices
  (2 ranks). Stacks multiplicatively with the reputation discount.
- **Auction house cut** — 0%, 5% (faction house), or 15% (neutral house).
- **Buy at cheapest / AH / vendor** toggle for material cost, and **sell to AH / vendor** for revenue.
- **Craft overhead** (extra seconds per craft: looting, clicking, walking to the vendor) folded into
  profit/hour; cooldown recipes (transmutes, Mooncloth) are gated by their cooldown instead.
- **Sortable table** by profession, skill, cast time, cost, sell price, profit/craft, and profit/hour.
- **Filters**: profession, how the recipe is obtained (vendor / auction house / both), skill range,
  search, "profitable only", and "hide missing prices".
- **Live AH prices** (from [ahprice.com](https://ahprice.com)): pick a market (region + ruleset + faction)
  and a price basis (lowest buyout / market average / true value), click **Load live AH prices**, and every
  material and crafted item is priced. Cached per market in your browser.
- **Listing info on hover** — in a recipe's detail view, hover an AH-sourced price to see how many units
  are listed at the lowest buyout, the market average, and the number of scans.
- **Editable prices** (persisted in your browser) with inline overrides from any recipe row. Manual values
  override the live feed.
- **Expandable detail view** — click any row to open a per-recipe breakdown: every reagent with its
  quantity, current price, source (vendor / AH) and inline manual override, plus a profit panel
  (material cost, AH cut, net sale, profit/craft, profit/hour, margin) on the right.

## Try it

Open `index.html` through any static server (the app fetches JSON, so `file://` won't work):

```bash
python -m http.server 8765 --directory .
# http://127.0.0.1:8765
```

Or push to a GitHub repository and enable **Settings → Pages → deploy from branch (main / root)**.

## How the math works

```
unitCost(material) =
  buy-at-vendor ? vendorBuy × (1 − rep%) × (1 − barter%)
  buy-at-AH     ? ahBuy
  cheapest      ? min( vendorBuy-discounted, ahBuy )

cost  = Σ unitCost(reagent) × qty
sell  = Σ outputQty × sellPrice × (1 − ahCut%)     (AH), or outputQty × vendorSell (vendor)
profit = sell − cost
profit/hour = profit × 3600 / interval,   interval = max(cooldown, cast) for cooldowns,
                                          else cast + overhead
```

`ahBuy` / `ahSell` resolve in this order: your **manual override** → **live AH price** (chosen basis) →
unknown. Vendor buy prices use the pre-loaded base value unless you override them.

Prices are **copper integers** everywhere; inputs accept shorthand like `1g 50s 25c` or `123` (copper).
A recipe with an unknown material cost or unknown sell price shows `—` for profit and is marked
"missing a price" until it is priced (live or manual).

## Live AH prices

The auction-house prices come from [ahprice.com](https://ahprice.com)'s public API
(`/api/v1/export/prices.csv`), fetched once per market and cached in your browser.

- **Market** = region + ruleset + faction (e.g. EU · Normal · Alliance), matching WoW Forever's
  realmless shared auction houses.
- **Price basis** — which AH value to use for both materials and the crafted item:
  *lowest buyout* (`latest_floor`), *market average*, or *true value*.
- Prices are cached per market; re-click **Load live AH prices** to refresh. Only items currently listed
  on the auction house have prices — anything unlisted shows as "missing a price" (the `Missing price`
  filter lists them). Coverage grows as the market matures.

## Data

### What's included

| File | Purpose |
| --- | --- |
| `data/recipes.json` | Compact recipe list (reagents, output, cast time, cooldown, skill, source) |
| `data/materials.json` | Item id → name for every reagent and output |
| `data/vendor-prices.json` | Curated vendor **buy** prices (copper) for vendor-sold materials |
| `data/vendor-sell.json` | Vendor **sell** (buyback) prices (copper) for every item, from Wowhead's Forever data |

### Sources & attribution

- **Recipe structure** (reagents, results, cast times, cooldowns, skill thresholds) is extracted from
  the WoW Forever game client (build `1.60.1.69876`, beta snapshot 2026-09-17) and derived from
  [MAF2414/wow-forever-talents](https://github.com/MAF2414/wow-forever-talents). This is client data,
  not a guarantee of live availability.

### Data quality notes

- A recipe whose output item has no name in the snapshot (a new Forever item) falls back to the recipe's
  own name — WoW recipes almost always craft their namesake item. Any remaining `Item #<id>` names are
  new materials whose names aren't in the Sept snapshot yet; they resolve automatically from the live
  AH feed (which carries real names) once the item is scanned, or when the source snapshot is refreshed.
- Recipes whose skill thresholds are missing in the client show skill `?` instead of a misleading `0`.
- "Obtained via" uses three values — **Vendor** (NPC: trainer/vendor/Merchant's Favor/quest), **Auction
  House** (a tradable recipe item), and **Both**. Recipes not yet mapped default to *Both*; refine them in
  `data-src/sources.json`.
- **Vendor material prices** come from the
  [WoW Forever Wiki](https://wowforever.wiki.fextralife.com/Vendors) and
  [wow-professions.com](https://www.wow-professions.com/forever).
- **Live AH prices** come from [ahprice.com](https://ahprice.com)'s public API.
- **Vendor sell (buyback) prices** come from [Wowhead](https://www.wowhead.com/forever)'s Forever item
  data (`dataEnv=16`), fetched once by `scripts/fetch-sell-prices.mjs`.

This is an unofficial fan tool. World of Warcraft, Warcraft and Blizzard are trademarks or registered
trademarks of Blizzard Entertainment, Inc. Not affiliated with or endorsed by Blizzard.

### Extending the data

- **Update everything (one command)** — re-download the latest client-extraction snapshot, rebuild the
  compact files, and refresh sell prices:

  ```bash
  npm run update
  ```

  (This pulls the newest published snapshot from `MAF2414/wow-forever-talents` and re-fetches sell
  prices from Wowhead's live Forever data, so it picks up new game builds as those sources update.)

- **Recipe list / skill thresholds / cast times** — replace `data-src/professions-data.json` with a
  newer export from the source repo, then re-run:

  ```bash
  node scripts/build-data.mjs
  ```

- **"How to obtain" (source)** — edit `data-src/sources.json` (keyed by exact recipe name; values
  `vendor` / `ah` / `both`, or granular `trainer` / `vendor` / `favor` / `drop` / `quest` which are
  collapsed to the three), then re-run the build. Unlisted recipes default to `both`.
- **Vendor prices** — edit `data-src/vendor-prices.json` (and copy to `data/`), or just edit them
  in-app.
- **Vendor sell prices** — re-fetch from Wowhead with `node scripts/fetch-sell-prices.mjs` (it resumes
  from the existing `data/vendor-sell.json`; `--limit N` tests a small batch).

## Project layout

```
index.html              app shell
css/styles.css          styling
js/app.js               all logic (filter, sort, profit math, price editing, persistence)
data/recipes.json       generated
data/materials.json     generated
data/vendor-prices.json vendor material BUY price seed
data/vendor-sell.json   vendor SELL (buyback) prices, from Wowhead
data-src/               source data + curated seeds (see .gitignore for the large raw export)
scripts/build-data.mjs  build script
scripts/fetch-sell-prices.mjs  vendor sell-price fetcher (one-time)
scripts/update-data.mjs  one-command update (download + rebuild + refetch)
```

## License

Code is yours to use however you like. Game data belongs to Blizzard; recipe extraction derives from
the client (see attribution above).
