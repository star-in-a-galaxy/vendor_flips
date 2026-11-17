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
      url = String(url);
      if (url.includes('/api/v1/realms')) return { ok: true, json: async () => ({ realms: [] }) };
      const path = url.replace('http://localhost/', '');
      const body = path.includes('recipes.json') ? recipes
        : path.includes('materials.json') ? materials
        : path.includes('vendor-prices.json') ? vendor
        : path.includes('vendor-sell.json') ? sell : '';
      if (!body) throw new Error('no stub');
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

// Open a recipe with vendor mats (Black Dye + Rune Thread) to see source badges.
doc.getElementById('search').value = 'Wicked Leather Gauntlets';
doc.getElementById('search').dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
doc.querySelector('#rows tr').click();
await new Promise((r) => setTimeout(r, 50));

const detail = doc.getElementById('detail');
console.log('detail has profit-panel:', !!detail.querySelector('.profit-panel'));
console.log('detail has breakdown rows:', detail.querySelectorAll('.breakdown tbody tr').length);
console.log('reagent rows:', detail.querySelectorAll('table.reagents tbody tr').length);
console.log('src badges:', [...detail.querySelectorAll('.src-badge')].map(b => b.textContent.trim()).join(', '));
console.log('breakdown text:', detail.querySelector('.breakdown')?.textContent.replace(/\s+/g, ' ').trim());
console.log('craft note:', detail.querySelector('.craft-note')?.textContent.trim());
