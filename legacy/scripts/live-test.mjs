import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const recipes = readFileSync('data/recipes.json', 'utf8');
const materials = readFileSync('data/materials.json', 'utf8');
const vendor = readFileSync('data/vendor-prices.json', 'utf8');
const sell = '{}';
const app = readFileSync('js/app.js', 'utf8');

const realmsJson = JSON.stringify({
  realms: [
    { market_id: 'eu-normal-alliance', label: 'Normal · Alliance', region: 'EU', faction: 'alliance', is_beta: false, last_scan_age_text: '5 min ago' },
    { market_id: 'eu-normal-horde', label: 'Normal · Horde', region: 'EU', faction: 'horde', is_beta: false, last_scan_age_text: '5 min ago' },
    { market_id: 'us-pvp-horde', label: 'PvP · Horde', region: 'US', faction: 'horde', is_beta: false, last_scan_age_text: '5 min ago' },
  ],
});

// A tiny live-price set: Light Leather, Coarse Thread, and the crafted output.
const liveItems = {
  2318: { item_id: 2318, name: 'Light Leather', true_value_copper: 110, market_avg_copper: 120, latest_floor_copper: 100, latest_floor_qty: 77, samples: 10 },
  2320: { item_id: 2320, name: 'Coarse Thread', true_value_copper: 10, market_avg_copper: 12, latest_floor_copper: 10, latest_floor_qty: 200, samples: 10 },
  2302: { item_id: 2302, name: 'Handstitched Leather Boots', true_value_copper: 550, market_avg_copper: 600, latest_floor_copper: 500, latest_floor_qty: 5, samples: 5 },
};

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = async (url) => {
      url = String(url);
      if (url.includes('/api/v1/realms')) return { ok: true, json: async () => JSON.parse(realmsJson) };
      if (url.includes('/api/v1/prices')) {
        const ids = (url.match(/ids=([\d,]+)/) || ['', ''])[1].split(',').map(Number);
        const items = ids.map((id) => liveItems[id]).filter(Boolean);
        return { ok: true, json: async () => ({ items }) };
      }
      const path = url.replace('http://localhost/', '');
      const body = path.includes('recipes.json') ? recipes
        : path.includes('materials.json') ? materials
        : path.includes('vendor-prices.json') ? vendor
        : path.includes('vendor-sell.json') ? sell : '';
      if (!body) throw new Error('no stub for ' + url);
      return { ok: true, json: async () => JSON.parse(body) };
    };
  },
});

const { window } = dom;
const doc = window.document;
window.eval(app);
await new Promise((r) => setTimeout(r, 150));
doc.dispatchEvent(new window.Event('DOMContentLoaded'));
await new Promise((r) => setTimeout(r, 500));

console.log('realm options:', doc.querySelectorAll('#realm option').length, '| default realm:', doc.getElementById('realm').value);
console.log('status before load:', doc.getElementById('ahStatus').textContent.trim());

// Click "Load live AH prices".
doc.getElementById('loadAh').click();
await new Promise((r) => setTimeout(r, 300));

console.log('status after load:', doc.getElementById('ahStatus').textContent.trim());

// Search for the recipe and check profit.
const search = doc.getElementById('search');
search.value = 'Handstitched Leather Boots';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
const cells = [...doc.querySelectorAll('#rows tr td')].map((td) => td.textContent.trim());
console.log('row cells:', cells.join(' | '));

// Overall stats should now show at least one profitable recipe.
const stats = doc.getElementById('stats').textContent;
console.log('stats:', stats.trim());

const profitable = /(\d+)Profitable/.exec(stats.replace(/\s+/g, ''));
console.log('profitable count:', profitable ? profitable[1] : '?');

// Basis switch sanity: set to market avg, profit should still compute.
doc.getElementById('basis').value = 'avg';
doc.getElementById('basis').dispatchEvent(new window.Event('change', { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
console.log('status after basis switch:', doc.getElementById('ahStatus').textContent.trim());

// "Hide missing prices" toggle should reduce the list to only fully-priced recipes (1 in the stub).
doc.getElementById('search').value = '';
doc.getElementById('search').dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
const before = doc.getElementById('stats').textContent.replace(/\s+/g, '');
doc.getElementById('hideMissing').checked = true;
doc.getElementById('hideMissing').dispatchEvent(new window.Event('change', { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
const after = doc.getElementById('stats').textContent.replace(/\s+/g, '');
console.log('before hide-missing:', before);
console.log('after hide-missing: ', after);
console.log('LIVE TEST DONE');
