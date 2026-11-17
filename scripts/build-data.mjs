// Builds site/data/flips.json from the raw WoW Forever client extraction plus the
// two price sources in data-src/.
//
// Usage:  node scripts/build-data.mjs   (or: npm run build)
//
// Inputs
//   data-src/professions-data.json  raw client extraction (gitignored, see README)
//   data-src/vendor-buy.json        curated vendor BUY prices, keyed by item name
//   data-src/vendor-sell.json       vendor SELL prices, keyed by item id (from Wowhead Forever)
//
// Output: site/data/flips.json
//   {
//     build, date,
//     items:   { [id]: { n: name, s?: vendorSell, b?: vendorBuy } },
//     recipes: [ { id, n, p, sk, cast, cd, o: [itemId, qty], r: [[itemId, qty], ...] } ]
//   }
// Only recipes whose output a vendor pays for are included: this is a vendor-flip tool.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const src = read('data-src/professions-data.json');
const vendorBuyByName = read('data-src/vendor-buy.json').items;
const vendorSell = read('data-src/vendor-sell.json');

const profName = Object.fromEntries(src.professions.map((p) => [p.id, p.name]));
const rawItems = src.items || {};
const UNRESOLVED = /^Item #?\d+$/;
// Records live in Forever. "inherited", "removed" and "seasonal" are not.
const LIVE = new Set(['new', 'changed', 'unchanged']);
// Recipe names that craft a differently named item.
const ACTION = /^(Transmute:|Smelt |Enchant |Disenchant|Create |Craft |Conjure |Pick |Skin |Prospect |Mill |Make )/i;

function nameOf(id, recipeName) {
  const n = rawItems[id]?.name;
  if (n && !UNRESOLVED.test(n)) return n;
  if (recipeName) {
    const smelt = recipeName.match(/^Smelt (.+)$/);
    if (smelt) return smelt[1];
    if (!ACTION.test(recipeName)) return recipeName; // most recipes craft their namesake
  }
  return n || `Item ${id}`;
}

const items = {};
function useItem(id, recipeName) {
  if (!items[id]) {
    const n = nameOf(id, recipeName);
    items[id] = { n };
    const s = Math.round(vendorSell[id] || 0);
    if (s > 0) items[id].s = s;
    if (vendorBuyByName[n] != null) items[id].b = vendorBuyByName[n];
  }
  return items[id];
}

const recipes = [];
const seen = new Set();
let skippedNoSell = 0;

for (const rec of src.records) {
  if (rec.kind !== 'recipe' || !LIVE.has(rec.status) || rec.seasonal) continue;
  const out = rec.outputs?.[0];
  if (!out || !rec.reagents?.length) continue;

  const sell = Math.round(vendorSell[out.id] || 0);
  if (sell <= 0) { skippedNoSell++; continue; }

  // Output quantities in the extraction carry float noise (e.g. 2.0000001); the
  // midpoint of min/max is the expected yield.
  const min = Math.max(Math.round(out.min || 1), 1);
  const max = Math.max(Math.round(out.max || min), min);
  const qty = (min + max) / 2;

  const r = rec.reagents.map((g) => [g.id, g.count || 1]);
  // Drop exact duplicates (same output, same reagents) that the client lists twice.
  const sig = out.id + '|' + qty + '|' + r.map((x) => x.join('x')).sort().join(',');
  if (seen.has(sig)) continue;
  seen.add(sig);

  useItem(out.id, rec.name);
  for (const [id] of r) useItem(id);

  recipes.push({
    id: rec.id,
    n: rec.name,
    p: profName[rec.professionID] || `Profession ${rec.professionID}`,
    sk: rec.skillupLow || null,
    cast: Math.round((rec.castTime || 0) * 100) / 100,
    cd: rec.cooldown || 0,
    o: [out.id, qty],
    r,
  });
}

recipes.sort((a, b) => a.p.localeCompare(b.p) || a.n.localeCompare(b.n));

mkdirSync(join(root, 'site', 'data'), { recursive: true });
const payload = { build: src.build, date: src.date, items, recipes };
writeFileSync(join(root, 'site', 'data', 'flips.json'), JSON.stringify(payload));

const byProf = {};
for (const r of recipes) byProf[r.p] = (byProf[r.p] || 0) + 1;
console.log(`Client build ${src.build} (${src.date})`);
console.log(`Wrote ${recipes.length} recipes, ${Object.keys(items).length} items to site/data/flips.json`);
console.log(`Skipped ${skippedNoSell} recipes whose output has no vendor price`);
for (const [p, c] of Object.entries(byProf).sort((a, b) => b[1] - a[1])) console.log(`  ${p.padEnd(16)} ${c}`);
