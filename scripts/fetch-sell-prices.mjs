// One-time fetcher: pull vendor SELL prices (buyback) for every item the calculator
// references, from Wowhead's Forever data (dataEnv=16).
//
// Usage:  node scripts/fetch-sell-prices.mjs [--limit N] [--recheck]
// Writes data-src/vendor-sell.json  ({ itemId: copper, ... }). Run `npm run build` afterwards.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const DATAENV = 16;
const DELAY_MS = 110;

const src = JSON.parse(readFileSync(join(root, 'data-src', 'professions-data.json'), 'utf8'));
const recipes = src.records.filter((r) => r.kind === 'recipe');

// Unique item ids — outputs first (what a vendor flip needs), then reagents.
const ids = new Set();
for (const r of recipes) for (const o of r.outputs || []) ids.add(o.id);
for (const r of recipes) for (const g of r.reagents || []) ids.add(g.id);
let idList = [...ids];

// Optional --limit N for testing.
const limitArg = process.argv.indexOf('--limit');
if (limitArg >= 0 && process.argv[limitArg + 1]) {
  idList = idList.slice(0, parseInt(process.argv[limitArg + 1], 10));
}

const outPath = join(root, 'data-src', 'vendor-sell.json');
const sell = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSell(id) {
  const url = `https://nether.wowhead.com/tooltip/item/${id}?dataEnv=${DATAENV}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (vendor-flips fan tool)' } });
  if (res.status === 404) return 0; // not in Wowhead's Forever database
  if (!res.ok) throw new Error('status ' + res.status);
  const j = await res.json();
  const block = (j.tooltip || '').match(/class="whtt-sellprice">([\s\S]*?)<\/div>/);
  if (!block) return 0; // no sell price: a vendor won't buy it
  const g = block[1].match(/moneygold">(\d+)</);
  const s = block[1].match(/moneysilver">(\d+)</);
  const c = block[1].match(/moneycopper">(\d+)</);
  if (!g && !s && !c) return 0;
  return (g ? +g[1] * 10000 : 0) + (s ? +s[1] * 100 : 0) + (c ? +c[1] : 0);
}

let done = 0, failed = 0, skipped = 0;
const t0 = Date.now();

// 0 means "checked, no vendor price". --recheck asks Wowhead about those again.
const recheck = process.argv.includes('--recheck');
for (const id of idList) {
  if (sell[id] != null && !(recheck && sell[id] === 0)) { skipped++; done++; continue; }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const v = await fetchSell(id);
      sell[id] = v;
      break;
    } catch (e) {
      if (attempt === 3) { failed++; if (failed <= 20) console.error('FAIL', id, e.message); }
      await sleep(400 * (attempt + 1));
    }
  }
  done++;
  if (done % 200 === 0) {
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`progress ${done}/${idList.length} · priced ${Object.keys(sell).length} · failed ${failed} · ${secs}s`);
    writeFileSync(outPath, JSON.stringify(sell));
  }
  await sleep(DELAY_MS);
}

writeFileSync(outPath, JSON.stringify(sell));
console.log(`DONE: ${Object.keys(sell).length} sell prices written (${failed} failed, ${skipped} skipped) → data-src/vendor-sell.json`);
