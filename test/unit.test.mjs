import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moneyText, moneyHTML, parseMoney } from '../site/js/money.js';
import { parsePriceCsv } from '../site/js/prices.js';
import { evaluate, materialPrice, secondsPerCraft, CRAFT_GAP_S } from '../site/js/flips.js';

test('cooldown recipes are limited by the cooldown, others by cast time', () => {
  assert.equal(secondsPerCraft({ cast: 60, cd: 0 }), 60 + CRAFT_GAP_S);
  assert.equal(secondsPerCraft({ cast: 25, cd: 3600 }), 3600);
  assert.equal(secondsPerCraft({ cast: 0, cd: 0 }), CRAFT_GAP_S);
  assert.equal(secondsPerCraft({ cast: 3, cd: 0 }, 1), 4);
});

test('money formats like the game', () => {
  assert.equal(moneyText(0), '0c');
  assert.equal(moneyText(5), '5c');
  assert.equal(moneyText(150), '1s 50c');
  assert.equal(moneyText(10000), '1g');
  assert.equal(moneyText(123456), '12g 34s 56c');
  assert.equal(moneyText(-2050), '-20s 50c');
  assert.equal(moneyText(null), '—');
  assert.match(moneyHTML(10005), /coin g">1<\/span><span class="coin c">5</);
  assert.match(moneyHTML(0), /coin c">0</);
});

test('money input accepts game notation and bare gold', () => {
  assert.equal(parseMoney('1g 20s'), 12000);
  assert.equal(parseMoney('50s'), 5000);
  assert.equal(parseMoney('1g20s5c'), 12005);
  assert.equal(parseMoney('2'), 20000);
  assert.equal(parseMoney('0.5'), 5000);
  assert.equal(parseMoney(''), null);
  assert.ok(Number.isNaN(parseMoney('lots')));
  assert.ok(Number.isNaN(parseMoney('5x')));
});

test('CSV parser handles quoted names and missing values', () => {
  const csv = 'item_id,name,market_avg_copper,latest_floor_copper,samples,last_seen_at,true_value_copper\n' +
    '2589,Linen Cloth,24,17,395,2026-11-17T19:57:36Z,24\n' +
    '9999,"Kodo, ""Big"" Steak",,50,2,,\n';
  const p = parsePriceCsv(csv);
  assert.deepEqual(p['2589'], [17, 24, 24, 395, Date.parse('2026-11-17T19:57:36Z')]);
  assert.deepEqual(p['9999'], [50, 0, 0, 2, 0]);
});

const items = {
  1: { n: 'Cloth' },
  2: { n: 'Thread', b: 100 },
  3: { n: 'Bag', s: 1000 },
};
const base = { items, basis: 'typical', rep: 0, barter: 0, now: Date.parse('2026-11-17T20:00:00Z') };
const seen = Date.parse('2026-11-17T19:00:00Z');

test('material price takes the cheaper of vendor and AH, with discounts', () => {
  const prices = { 2: [80, 90, 95, 50, seen] };
  assert.equal(materialPrice(2, { ...base, prices }).source, 'ah');
  const disc = materialPrice(2, { ...base, prices, rep: 0.1, barter: 0.1 }); // 100 * 0.9 * 0.9 = 81
  assert.equal(disc.price, 81);
  assert.equal(disc.source, 'vendor');
  assert.equal(materialPrice(2, { ...base, prices, basis: 'floor' }).price, 80);
});

test('AH prices with too few samples are ignored', () => {
  assert.equal(materialPrice(1, { ...base, prices: { 1: [10, 10, 10, 1, seen] } }).price, null);
});

test('evaluate computes profit, margin and marks missing prices', () => {
  const recipe = { id: 1, n: 'Bag', p: 'Tailoring', cast: 3, cd: 0, o: [3, 1], r: [[1, 4], [2, 1]] };
  const e = evaluate(recipe, { ...base, prices: { 1: [100, 150, 150, 40, seen] } });
  assert.equal(e.cost, 4 * 150 + 100);
  assert.equal(e.revenue, 1000);
  assert.equal(e.profit, 300);
  assert.equal(Math.round(e.margin * 100), 43);
  assert.equal(e.perHour, Math.round((300 * 3600) / (3 + CRAFT_GAP_S)));

  const missing = evaluate(recipe, { ...base, prices: {} });
  assert.equal(missing.profit, null);
  assert.equal(missing.missing, 1);
});

test('built data is present and consistent', () => {
  const d = JSON.parse(readFileSync(new URL('../site/data/flips.json', import.meta.url)));
  assert.ok(d.recipes.length > 1000, 'expected the full recipe list');
  for (const r of d.recipes) {
    assert.ok(d.items[r.o[0]]?.s > 0, `${r.n} output has a vendor price`);
    assert.ok(Number.isFinite(r.o[1]) && r.o[1] >= 1, `${r.n} has a sane yield`);
    for (const [id] of r.r) assert.ok(d.items[id], `${r.n} reagent ${id} is known`);
  }
});
