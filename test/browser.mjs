// Browser check in your installed Chrome (or Edge): node test/browser.mjs [--live]
//
// By default ahprice.com is replaced by a small fixture so the test is repeatable and
// spends none of the API's daily quota. --live uses the real API (2 requests).
// Screenshots land in test/shots/.

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { serve } from '../scripts/serve.mjs';

const live = process.argv.includes('--live');
const PORT = 8790;
const PAGE = `http://127.0.0.1:${PORT}/`;
mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });
const shot = (name) => new URL(`./shots/${name}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

const REALMS = { realms: [
  { market_id: 'eu-normal-alliance', label: 'Normal · Alliance', region: 'EU', faction: 'alliance', is_beta: false, last_scan_at: new Date().toISOString() },
  { market_id: 'eu-normal-horde', label: 'Normal · Horde', region: 'EU', faction: 'horde', is_beta: false, last_scan_at: new Date().toISOString() },
] };
const now = new Date().toISOString();
// Felcloth is cheap and Linen Cloth is cheap: Felblood Soul Bag and Linen Bag become flips.
const CSV = ['item_id,name,market_avg_copper,latest_floor_copper,samples,last_seen_at,true_value_copper',
  `14256,Felcloth,9000,8000,200,${now},8500`,
  `2589,Linen Cloth,20,15,300,${now},18`,
  `2996,Bolt of Linen Cloth,60,50,300,${now},55`,
  `14048,Bolt of Runecloth,1500,1400,300,${now},1450`,
  `2318,Light Leather,30,25,300,${now},28`,
].join('\n');

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

const server = await serve(PORT);
let browser;
for (const channel of ['chrome', 'msedge']) {
  try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* try next */ }
}
if (!browser) { console.error('No Chrome or Edge found.'); process.exit(1); }

// Wait for flips; on failure say what the page showed instead of a bare timeout.
let liveCsv = null;
async function waitForRows(p) {
  try {
    await p.waitForSelector('.row', { timeout: 45000 });
  } catch {
    throw new Error('No flips appeared. Status line: ' + (await p.locator('#status').innerText()));
  }
}

async function page(viewport, { failPrices = false } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: 'dark' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (live) {
    // One real download per test run: the export allows only ~12 an hour.
    await p.route('https://ahprice.com/api/v1/export/**', async (r) => {
      liveCsv ??= await fetch(r.request().url()).then(async (res) => {
        if (!res.ok) throw new Error('ahprice.com export failed: ' + res.status + ' ' + (await res.text()).slice(0, 120));
        return res.text();
      });
      await r.fulfill({ body: liveCsv, contentType: 'text/csv', headers: { 'Access-Control-Allow-Origin': '*' } });
    });
  } else {
    await p.route('https://ahprice.com/api/v1/realms', (r) => r.fulfill({ json: REALMS, headers: { 'Access-Control-Allow-Origin': '*' } }));
    await p.route('https://ahprice.com/api/v1/export/**', (r) => failPrices
      ? r.fulfill({ status: 429, body: 'slow down', headers: { 'Access-Control-Allow-Origin': '*', 'Retry-After': '1438', 'Access-Control-Expose-Headers': 'Retry-After' } })
      : r.fulfill({ body: CSV, contentType: 'text/csv', headers: { 'Access-Control-Allow-Origin': '*' } }));
  }
  await p.goto(PAGE);
  return { p, ctx, errors };
}

try {
  // Desktop: list loads, top flip is selected and its detail is visible.
  {
    const { p, ctx, errors } = await page({ width: 1440, height: 900 });
    await waitForRows(p);
    const rows = await p.locator('.row').count();
    check(rows > 0, `desktop shows ${rows} flips`);
    check(await p.locator('#detail').isVisible(), 'detail panel is visible without clicking');
    check(await p.locator('.row[aria-current="true"]').count() === 1, 'top flip is selected');
    check((await p.locator('#status').innerText()).includes('fetched'), 'status line says when prices were fetched');
    if (!live) check((await p.locator('.row .r-title').first().innerText()) === 'Felblood Soul Bag', 'best flip ranks first');

    // Crafts stepper scales the shopping list.
    const need1 = await p.locator('.shop tbody tr td.num').first().innerText();
    await p.click('.step[data-step="1"]');
    const need2 = await p.locator('.shop tbody tr td.num').first().innerText();
    check(+need2 === +need1 * 2, `2 crafts doubles the materials (${need1} -> ${need2})`);

    // Clicking another row switches the detail.
    if (rows > 1) {
      const second = p.locator('.row').nth(1);
      const name = await second.locator('.r-title').innerText();
      await second.click();
      check((await p.locator('#detail-title').innerText()) === name, 'clicking a row opens its detail');
    }

    // Filters.
    await p.fill('#search', 'zzzz-nothing');
    await p.waitForTimeout(250);
    check(await p.locator('.row').count() === 0, 'search with no match empties the list');
    check((await p.locator('#listNote').innerText()).includes('Nothing matches'), 'empty search explains itself');
    await p.fill('#search', '');
    await p.waitForTimeout(250);
    const hiddenNote = await p.locator('#listNote').innerText();
    await p.check('#losing');
    const losses = await p.locator('.row.is-loss').count();
    check(losses > 0, 'losing crafts appear when asked');
    check(hiddenNote.includes(`${losses} more craft${losses === 1 ? ' loses' : 's lose'} money and`), `note counts the hidden losing crafts (${losses}): ${hiddenNote}`);
    await p.uncheck('#losing');

    const hours = await p.locator('.row .hour').allTextContents();
    check(hours.length > 0 && hours.every((h) => h.trim() !== '—'), 'every listed flip has a per-hour value');
    check((await p.locator('.d-hour').count()) === 1, 'detail shows profit per hour');

    // Column headers sort, and a second click flips the direction.
    const names = () => p.locator('.row .r-title').allTextContents();
    await p.click('.list-head .sort[data-sort="name"]');
    const az = await names();
    check(JSON.stringify(az) === JSON.stringify([...az].sort((a, b) => a.localeCompare(b))), 'Recipe header sorts A to Z');
    check(await p.getAttribute('.list-head .sort[data-sort="name"]', 'data-dir') === 'asc', 'sorted header shows its direction');
    await p.click('.list-head .sort[data-sort="name"]');
    check(JSON.stringify(await names()) === JSON.stringify([...az].reverse()), 'second click reverses to Z to A');
    await p.click('.list-head .sort[data-sort="cost"]');
    await p.click('.list-head .sort[data-sort="cost"]');
    check(await p.getAttribute('.list-head .sort[data-sort="cost"]', 'data-dir') === 'asc', 'Materials sorts low to high on second click');
    check(await p.inputValue('#sort') === 'cost:asc', 'phone sort menu follows the header');
    await p.click('.list-head .sort[data-sort="profit"]');

    // More filters.
    const before = await p.locator('.row').count();
    await p.click('#more summary');
    await p.fill('#minMargin', '1000');
    await p.waitForTimeout(300);
    check(await p.locator('.row').count() === 0, 'a 1000% minimum margin hides everything');
    check((await p.locator('#moreCount').innerText()).includes('1 on'), 'filter count shows on the summary');
    await p.fill('#minProfit', 'lots');
    check((await p.locator('#minProfitErr').innerText()).length > 0, 'bad money input explains the format');
    await p.click('#resetFilters');
    await p.waitForTimeout(300);
    check(await p.locator('.row').count() === before, 'Reset filters brings every flip back');
    const tailoring = await p.locator('#skills input[data-prof="Tailoring"]');
    await tailoring.fill('1');
    await p.waitForTimeout(300);
    const subs = await p.locator('.row .r-sub').allTextContents();
    check(subs.every((t) => !/^Tailoring, skill (\d+)/.test(t) || +t.match(/skill (\d+)/)[1] <= 1), 'Tailoring skill 1 hides higher Tailoring recipes');
    await p.click('#resetFilters');
    await p.click('#more summary');

    await p.screenshot({ path: shot('desktop-1440'), fullPage: false });
    check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  // Phone: detail opens as a sheet and closes again.
  {
    const { p, ctx, errors } = await page({ width: 390, height: 844 });
    await waitForRows(p);
    await p.screenshot({ path: shot('phone-list') });
    check(!(await p.locator('#detail').isVisible()), 'phone: detail starts closed');
    await p.locator('.row').first().click();
    await p.waitForTimeout(350);
    check(await p.locator('#detail.is-open').isVisible(), 'phone: tapping a row opens the detail sheet');
    await p.screenshot({ path: shot('phone-detail') });
    await p.click('#closeDetail');
    await p.waitForTimeout(350);
    check(!(await p.locator('#detail.is-open').count()), 'phone: Back to list closes the sheet');
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(!overflow, 'phone: no sideways scrolling');
    check(errors.length === 0, 'phone: no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  // A failing API shows a clear error instead of an empty page.
  if (!live) {
    const { p, ctx } = await page({ width: 1440, height: 900 }, { failPrices: true });
    await p.waitForSelector('#status.is-error', { timeout: 10000 });
    const msg = await p.locator('#status').innerText();
    check(/limit is used up/.test(msg), 'rate-limit error is explained: ' + msg);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);
