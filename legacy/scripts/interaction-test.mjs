import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const recipes = readFileSync('data/recipes.json', 'utf8');
const materials = readFileSync('data/materials.json', 'utf8');
const vendor = readFileSync('data/vendor-prices.json', 'utf8');
const sell = '{}';
const app = readFileSync('js/app.js', 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = async (url) => {
      const path = String(url).replace('http://localhost/', '');
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
await new Promise((r) => setTimeout(r, 100));
doc.dispatchEvent(new window.Event('DOMContentLoaded'));
await new Promise((r) => setTimeout(r, 400));

const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

// Filter to a single recipe.
doc.getElementById('search').value = 'Handstitched Leather Boots';
fire(doc.getElementById('search'), 'input');
await new Promise((r) => setTimeout(r, 50));
doc.querySelector('#rows tr').click();
await new Promise((r) => setTimeout(r, 50));

// Helper: set a price override by clicking an editable cell and committing.
function set(field, value) {
  const cell = [...doc.querySelectorAll('#detail td.editable')].find((c) => c.dataset.field === field);
  cell.click();
  const inp = cell.querySelector('input');
  inp.value = value;
  inp.dispatchEvent(new window.Event('blur', { bubbles: true }));
  return new Promise((r) => setTimeout(r, 30));
}

// Handstitched Leather Boots = 2x Light Leather + 1x Coarse Thread.
// Set Light Leather buy override (field 'buy', first material) and output sell override ('sell').
await set('buy', '1s');    // Light Leather override
await set('sell', '5s');   // output override

// Read current detail meta + row cells.
const meta = doc.querySelector('#detail .meta')?.textContent || '';
console.log('detail meta (2nd):', [...doc.querySelectorAll('#detail .meta')].map(m => m.textContent).join(' | '));
console.log('row cost/sell/profit:', ['td:nth-child(6)','td:nth-child(7)','td:nth-child(8)'].map(s => doc.querySelector('#rows tr ' + s)?.textContent.trim()).join(' | '));

// Check persisted prices via export (Blob not available in jsdom; instead read localStorage).
console.log('localStorage prices:', window.localStorage.getItem('wowf-prices-v1'));
