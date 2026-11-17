import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const recipes = readFileSync('data/recipes.json', 'utf8');
const materials = readFileSync('data/materials.json', 'utf8');
const vendor = readFileSync('data/vendor-prices.json', 'utf8');
const sell = '{}';
const app = readFileSync('js/app.js', 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = async (url) => {
      const path = String(url).replace('http://localhost/', '');
      const body = path.includes('recipes.json') ? recipes
        : path.includes('materials.json') ? materials
        : path.includes('vendor-prices.json') ? vendor
        : path.includes('vendor-sell.json') ? sell
        : '';
      if (!body) throw new Error('no stub for ' + url);
      return { ok: true, json: async () => JSON.parse(body) };
    };
  },
});

const { window } = dom;
window.eval(app);

// init() runs on DOMContentLoaded. jsdom may have already fired it before we eval'd.
// Dispatch manually to be safe.
await new Promise((res) => setTimeout(res, 200));
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

// Give the async init a chance to finish.
await new Promise((res) => setTimeout(res, 400));

const rows = window.document.querySelectorAll('#rows tr').length;
const stats = window.document.getElementById('stats').textContent;
const foot = window.document.getElementById('tableFoot').textContent;
const buildNote = window.document.getElementById('buildNote').textContent;

console.log('rows rendered:', rows);
console.log('stats:', stats.trim());
console.log('foot:', foot.trim());
console.log('buildNote:', buildNote.trim());

if (rows === 0) { console.error('FAIL: no rows rendered'); process.exit(1); }
console.log('SMOKE TEST OK');
