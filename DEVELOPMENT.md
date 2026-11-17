# Development

```bash
npm install                     # once
npm start                       # http://127.0.0.1:8765
npm test                        # unit tests
npm run test:browser            # browser checks with sample prices (needs Chrome or Edge)
npm run test:browser -- --live  # same, with real ahprice.com prices
```

Every push to `main` tests the code and publishes `site/` to GitHub Pages (`.github/workflows/pages.yml`).

## Data

| What | Source | Where |
|---|---|---|
| Recipes, cast times, cooldowns | Forever client extraction from [MAF2414/wow-forever-talents](https://github.com/MAF2414/wow-forever-talents) | `site/data/flips.json` (built) |
| Vendor sell prices | [Wowhead Forever](https://www.wowhead.com/forever) | `data-src/vendor-sell.json` |
| Vendor buy prices | Entered by hand | `data-src/vendor-buy.json` |
| Auction prices | [ahprice.com](https://ahprice.com) CSV export, loaded in the browser | cached in localStorage |

```bash
npm run update   # new client extraction + new Wowhead prices, then rebuild
npm run build    # rebuild site/data/flips.json from data-src/
```

`node scripts/fetch-sell-prices.mjs --recheck` asks Wowhead again about items stored with sell price `0`.

ahprice.com allows about 12 CSV downloads an hour per IP, so the page caches each market for 30 minutes.

## The numbers

```
profit   = vendor sell price x yield - sum(cheapest material price x quantity)
per hour = profit x 3600 / (cast time + gap)     cooldown recipes: profit x 3600 / cooldown
```

- Each material uses whichever is cheaper: the vendor price (after discounts) or the auction price.
- Auction prices with fewer than 3 observations are ignored, and prices older than 3 days are marked old.
- The gap between crafts defaults to 0.3 s and can be changed under More filters.

The recipe list covers every live Forever recipe whose result a vendor buys (1,952 of 2,051). Season of
Discovery records are left out. The extraction is from the 17 September 2026 beta client.

`legacy/` holds the previous version for reference.
