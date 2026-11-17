/* WoW Forever · Vendor Flip Calculator */
'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  search: '',
  prof: '',
  source: '',
  skillMin: 0,
  skillMax: 400,
  rep: 0,            // reputation discount %
  barter: 0,         // Legacy Bartering discount %
  ahCut: 0,          // auction house cut %
  matmode: 'min',    // min | ah | vendor
  sellmode: 'ah',    // ah | vendor
  overhead: 1,       // seconds added per craft
  onlyProfit: false,
  hideMissing: false,
  sort: { key: 's', dir: 1 },
  selected: null,
  cap: 300,
  realm: '',
  basis: 'floor',      // floor | avg | true
};

let RECIPES = [];
let ID2NAME = {};        // id(string) -> name
let NAME2IDS = {};       // lowercased name -> [id, ...]
let VENDOR_SEED = {};    // id(string) -> copper  (vendor BUY prices)
let VENDOR_SELL = {};    // id(string) -> copper  (vendor SELL/buyback prices)
let priceStore = {};     // id -> { v, a, sv, sa } overrides (persisted)
let BUILD = '';
let DATA_DATE = '';
let livePrices = {};     // id -> { f: floor, a: avg, t: true } live AH prices
let liveNames = {};      // id -> real name from the live feed (resolves "Item #" gaps)
let liveMeta = null;     // { realm, fetchedAt, count }

const $ = (id) => document.getElementById(id);
const LS_PRICES = 'wowf-prices-v1';
const LS_SETTINGS = 'wowf-settings-v1';

// ---------------------------------------------------------------------------
// Money helpers (all values in copper)
// ---------------------------------------------------------------------------
function fmt(c) {
  if (c == null || Number.isNaN(c)) return '—';
  const neg = c < 0;
  c = Math.round(Math.abs(c));
  const g = Math.floor(c / 10000);
  const s = Math.floor((c % 10000) / 100);
  const cc = c % 100;
  const parts = [];
  if (g) parts.push(g + 'g');
  if (s) parts.push(s + 's');
  if (cc || parts.length === 0) parts.push(cc + 'c');
  return (neg ? '-' : '') + parts.join(' ');
}

function parseMoney(str) {
  if (str == null) return null;
  str = String(str).trim().toLowerCase();
  if (!str) return null;
  if (/^-?\d+(\.\d+)?$/.test(str)) return Math.round(parseFloat(str));
  const re = /(-?\d+(?:\.\d+)?)([gsc])/g;
  let m, total = 0, any = false;
  while ((m = re.exec(str))) {
    const v = parseFloat(m[1]);
    if (m[2] === 'g') total += v * 10000;
    else if (m[2] === 's') total += v * 100;
    else total += v;
    any = true;
  }
  return any ? Math.round(total) : null;
}

// ---------------------------------------------------------------------------
// Price model
// ---------------------------------------------------------------------------
function seedVendor(id) { return VENDOR_SEED[String(id)] ?? null; }

// Manual overrides: one "buy" price (materials) and one "sell" price (outputs) per item.
function overrideBuy(id) { return priceStore[String(id)] ? (priceStore[String(id)].buy ?? null) : null; }
function overrideSell(id) { return priceStore[String(id)] ? (priceStore[String(id)].sell ?? null) : null; }

function vendorBuy(id) { return seedVendor(id); }
function vendorSell(id) { return VENDOR_SELL[String(id)] ?? null; }

// Live AH price (per chosen basis), used for both materials and outputs.
function liveValue(id) {
  const p = livePrices[String(id)];
  if (!p) return null;
  if (state.basis === 'avg') return p.a;
  if (state.basis === 'true') return p.t;
  return p.f;
}

function effectiveVendorBuy(id) {
  const base = vendorBuy(id);
  if (base == null) return null;
  return base * (1 - state.rep / 100) * (1 - state.barter / 100);
}

function unitCost(id) {
  const ov = overrideBuy(id);
  if (ov != null) return ov;
  if (state.matmode === 'ah') return liveValue(id);
  if (state.matmode === 'vendor') return effectiveVendorBuy(id);
  // cheapest
  const v = effectiveVendorBuy(id);
  const a = liveValue(id);
  if (v == null && a == null) return null;
  if (v == null) return a;
  if (a == null) return v;
  return Math.min(v, a);
}

function outputQty(o) {
  if (o.min != null && o.max != null && o.min !== o.max) return (o.min + o.max) / 2;
  return o.q || 1;
}

function sellPriceFor(o) {
  const ov = overrideSell(o.i);
  if (ov != null) return ov;
  return state.sellmode === 'ah' ? liveValue(o.i) : vendorSell(o.i);
}

// compute profit info for a recipe (returns null when incomplete)
function compute(r) {
  let cost = 0, costKnown = true;
  for (const rg of r.rg) {
    const uc = unitCost(rg.i);
    if (uc == null) costKnown = false;
    else cost += uc * rg.q;
  }

  let sell = 0, sellKnown = true;
  const cut = state.sellmode === 'ah' ? state.ahCut / 100 : 0;

  for (const o of r.out) {
    const sp = sellPriceFor(o);
    if (sp == null) sellKnown = false;
    else sell += sp * outputQty(o) * (1 - cut);
  }

  const missing = !costKnown || !sellKnown;
  const profit = missing ? null : sell - cost;

  let perHour = null;
  if (!missing) {
    let t = r.cd > 0 ? Math.max(r.cd, r.cast || 0) : (r.cast || 0) + state.overhead;
    if (t <= 0) t = 2;
    perHour = profit * 3600 / t;
  }

  return { cost: costKnown ? cost : null, sell: sellKnown ? sell : null, profit, perHour, missing, costKnown, sellKnown };
}

// ---------------------------------------------------------------------------
// Filters & sorting
// ---------------------------------------------------------------------------
function matchesSearch(r, q) {
  if (!q) return true;
  q = q.toLowerCase();
  if (r.n.toLowerCase().includes(q)) return true;
  if ((r.c || '').toLowerCase().includes(q)) return true;
  if (r.p.toLowerCase().includes(q)) return true;
  for (const o of r.out) if (displayName(o.n, o.i).toLowerCase().includes(q)) return true;
  for (const rg of r.rg) if (displayName(rg.n, rg.i).toLowerCase().includes(q)) return true;
  return false;
}

function filtered() {
  const out = [];
  for (const r of RECIPES) {
    if (state.prof && r.p !== state.prof) continue;
    if (state.source && r.src !== state.source) continue;
    if (r.s < state.skillMin || r.s > state.skillMax) continue;
    if (!matchesSearch(r, state.search)) continue;
    const c = compute(r);
    if (state.onlyProfit && (c.profit == null || c.profit <= 0)) continue;
    if (state.hideMissing && c.missing) continue;
    out.push({ r, c });
  }
  return out;
}

function sortVal(r, c, key) {
  switch (key) {
    case 'n': return r.n.toLowerCase();
    case 'p': return r.p;
    case 's': return r.s;
    case 'src': return r.src;
    case 'cast': return r.cast || 0;
    case 'cost': return c.cost == null ? null : c.cost;
    case 'sell': return c.sell == null ? null : c.sell;
    case 'profit': return c.profit == null ? null : c.profit;
    case 'ph': return c.perHour == null ? null : c.perHour;
    default: return r.n.toLowerCase();
  }
}

function sorted(list) {
  const { key, dir } = state.sort;
  const isNum = ['s', 'cast', 'cost', 'sell', 'profit', 'ph'].includes(key);
  return list.slice().sort((a, b) => {
    let va = sortVal(a.r, a.c, key);
    let vb = sortVal(b.r, b.c, key);
    if (isNum) {
      if (va == null && vb == null) va = vb = 0;
      else if (va == null) va = -Infinity;
      else if (vb == null) vb = -Infinity;
    }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return a.r.n.localeCompare(b.r.n);
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const SRC_LABEL = { vendor: 'Vendor', ah: 'Auction House', both: 'Both' };

const UNRESOLVED_RE = /^Item #?\d+$/;
// Resolve an item name, preferring a live-feed name when the snapshot only has "Item #id".
function displayName(n, id) {
  if (n && !UNRESOLVED_RE.test(n)) return n;
  const ln = liveNames[String(id)];
  if (ln && !UNRESOLVED_RE.test(ln)) return ln;
  return n || ('Item #' + id);
}

function reagentSummary(r) {
  const parts = r.rg.map((x) => x.q + '× ' + displayName(x.n, x.i));
  if (parts.length > 3) return parts.slice(0, 3).join(' · ') + ' · +' + (parts.length - 3);
  return parts.join(' · ');
}

function badge(r) {
  if (r.st === 'new') return '<span class="badge new">New</span>';
  if (r.st === 'changed') return '<span class="badge changed">Changed</span>';
  return '';
}

function moneyCell(v, extra) {
  if (v == null) return '<span class="money na">—</span>';
  const cls = v > 0 ? 'good' : (v < 0 ? 'bad' : '');
  return '<span class="money ' + cls + '">' + fmt(v) + '</span>' + (extra || '');
}

function renderRows(list) {
  const tbody = $('rows');
  const slice = list.slice(0, state.cap);
  const frag = document.createDocumentFragment();
  for (const { r, c } of slice) {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    if (state.selected === r.id) tr.classList.add('selected');
    tr.innerHTML =
      '<td class="name-cell">' + esc(r.n) + badge(r) +
        '<span class="sub">' + esc(reagentSummary(r)) + '</span></td>' +
      '<td class="prof-tag">' + esc(r.p) + '</td>' +
      '<td class="num">' + (r.s > 0 ? r.s : '?') + '</td>' +
      '<td><span class="src-tag ' + r.src + '">' + (SRC_LABEL[r.src] || r.src) + '</span></td>' +
      '<td class="num">' + castCell(r) + '</td>' +
      '<td class="num">' + moneyCell(c.cost) + '</td>' +
      '<td class="num">' + moneyCell(c.sell) + '</td>' +
      '<td class="num">' + moneyCell(c.profit) + '</td>' +
      '<td class="num">' + moneyCell(c.perHour) + '</td>';
    tr.addEventListener('click', () => {
      const willSelect = state.selected !== r.id;
      state.selected = willSelect ? r.id : null;
      renderAll();
      if (willSelect) {
        const d = $('detail');
        if (d && !d.classList.contains('hidden') && typeof d.scrollIntoView === 'function') {
          d.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
    frag.appendChild(tr);
  }
  tbody.replaceChildren(frag);
  return slice.length;
}

function castCell(r) {
  let s = (r.cast || 0) + 's';
  if (r.cd > 0) s += ' <span class="badge cooldown">' + fmtCd(r.cd) + ' cd</span>';
  return s;
}

function fmtCd(sec) {
  if (sec >= 86400) return Math.round(sec / 86400) + 'd';
  if (sec >= 3600) return Math.round(sec / 3600) + 'h';
  if (sec >= 60) return Math.round(sec / 60) + 'm';
  return sec + 's';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function renderStats(list) {
  let profitable = 0, missing = 0;
  for (const { c } of list) {
    if (c.profit != null && c.profit > 0) profitable++;
    if (c.missing) missing++;
  }
  $('stats').innerHTML =
    stat(list.length, 'Recipes shown') +
    stat(profitable, 'Profitable', 'good') +
    stat(missing, 'Missing a price', 'bad') +
    stat(RECIPES.length, 'Total in database');
}

function stat(v, label, cls) {
  return '<div class="stat"><div class="v ' + (cls || '') + '">' + v + '</div><div class="l">' + label + '</div></div>';
}

function renderTableFoot(shown, total) {
  const cut = state.sellmode === 'ah' ? state.ahCut : 0;
  const rep = state.rep ? ' · rep −' + state.rep + '%' : '';
  const bar = state.barter ? ' · barter −' + state.barter + '%' : '';
  const left =
    'Showing <b>' + shown + '</b> of <b>' + total + '</b>' +
    ' · AH cut ' + cut + '%' + rep + bar;
  const right = (shown < total)
    ? '<button class="btn" id="moreBtn">Show ' + Math.min(state.cap + 300, total) + '</button>'
    : '';
  $('tableFoot').innerHTML = '<span>' + left + '</span>' + right;
  const mb = $('moreBtn');
  if (mb) mb.addEventListener('click', () => { state.cap += 300; renderAll(); });
}

function renderTableHeader() {
  const th = document.querySelectorAll('thead th.sortable');
  th.forEach((el) => {
    const key = el.dataset.sort;
    if (state.sort.key === key) {
      el.classList.add('sorted');
      el.dataset.arrow = state.sort.dir === 1 ? '▲' : '▼';
    } else {
      el.classList.remove('sorted');
      delete el.dataset.arrow;
    }
  });
}

function renderAll() {
  const list = sorted(filtered());
  const shown = renderRows(list);
  renderStats(list);
  renderTableFoot(shown, list.length);
  renderTableHeader();
  renderDetail();
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
// Which source a material's unit cost currently comes from (vendor / AH / override / none).
function unitCostInfo(id) {
  const ov = overrideBuy(id);
  if (ov != null) return { cost: ov, source: 'override', vendor: effectiveVendorBuy(id), ah: liveValue(id) };
  const v = effectiveVendorBuy(id);
  const a = liveValue(id);
  let cost = null, source = null;
  if (state.matmode === 'ah') { cost = a; source = a != null ? 'ah' : null; }
  else if (state.matmode === 'vendor') { cost = v; source = v != null ? 'vendor' : null; }
  else {
    if (v == null && a == null) { cost = null; source = null; }
    else if (v == null) { cost = a; source = 'ah'; }
    else if (a == null) { cost = v; source = 'vendor'; }
    else if (a < v) { cost = a; source = 'ah'; }
    else { cost = v; source = 'vendor'; }
  }
  return { cost, source, vendor: v, ah: a };
}

function srcBadge(source) {
  return source === 'vendor' ? '<span class="src-badge vendor">Vendor</span>'
    : source === 'ah' ? '<span class="src-badge ah">AH</span>'
    : source === 'override' ? '<span class="src-badge override">Override</span>'
    : '<span class="src-badge none">—</span>';
}

// Hover tooltip for an item's AH listing info (units at the lowest buyout, market avg, scans).
function ahTipAttr(id) {
  const p = livePrices[String(id)];
  if (!p) return '';
  const lines = [];
  if (p.f > 0) {
    lines.push('Lowest buyout: ' + fmt(p.f));
    if (p.q != null) {
      lines.push(p.q > 0 ? ('Listed at that price: ' + p.q + ' unit' + (p.q === 1 ? '' : 's')) : 'None listed at that price right now');
    }
  }
  if (p.a > 0) lines.push('Market average: ' + fmt(p.a));
  if (p.n > 0) lines.push('Scans: ' + p.n);
  if (!lines.length) return '';
  return ' data-tip="' + lines.join('&#10;') + '"';
}

function renderDetail() {
  const el = $('detail');
  if (state.selected == null) { el.classList.add('hidden'); return; }
  const r = RECIPES.find((x) => x.id === state.selected);
  if (!r) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const c = compute(r);

  // Materials rows
  let matRows = '';
  for (const rg of r.rg) {
    const info = unitCostInfo(rg.i);
    const total = info.cost == null ? null : info.cost * rg.q;
    const ov = overrideBuy(rg.i);
    const tip = ahTipAttr(rg.i);
    matRows +=
      '<tr class="reagent-row">' +
        '<td class="reagent-name"><b>' + esc(displayName(rg.n, rg.i)) + '</b></td>' +
        '<td class="num qty">' + rg.q + '</td>' +
        '<td>' + srcBadge(info.source) + '</td>' +
        '<td class="num mono editable' + (tip ? ' tip' : '') + '"' + tip + ' data-id="' + rg.i + '" data-field="buy" data-ov="' + (ov == null ? '' : ov) + '">' + (info.cost == null ? '—' : fmt(info.cost)) + '</td>' +
        '<td class="num mono">' + (total == null ? '—' : fmt(total)) + '</td>' +
      '</tr>';
  }
  if (!matRows) matRows = '<tr><td colspan="5" class="empty">No materials.</td></tr>';

  // Output rows
  let outRows = '';
  for (const o of r.out) {
    const q = outputQty(o);
    const isAvg = o.min != null && o.max != null && o.min !== o.max;
    const sp = sellPriceFor(o);
    const ov = overrideSell(o.i);
    const tip = ahTipAttr(o.i);
    outRows += '<tr><td class="reagent-name"><b>' + esc(displayName(o.n, o.i)) + '</b></td>' +
      '<td class="num qty">' + q + (isAvg ? ' <span class="avg">avg</span>' : '') + '</td>' +
      '<td class="num mono editable' + (tip ? ' tip' : '') + '"' + tip + ' data-id="' + o.i + '" data-field="sell" data-ov="' + (ov == null ? '' : ov) + '">' + (sp == null ? '—' : fmt(sp)) + '</td></tr>';
  }

  // Profit breakdown
  const cutRate = state.sellmode === 'ah' ? state.ahCut / 100 : 0;
  const gross = (c.sell != null && cutRate > 0) ? c.sell / (1 - cutRate) : c.sell;
  const cutAmt = (gross != null && cutRate > 0) ? gross - c.sell : 0;
  const margin = (c.profit != null && c.sell != null && c.sell > 0) ? c.profit / c.sell * 100 : null;

  const profitCls = (v) => v == null ? '' : (v > 0 ? 'good' : (v < 0 ? 'bad' : ''));

  const pRows = [
    '<tr><td>Material cost</td><td class="num mono">' + fmt(c.cost) + '</td></tr>',
    (cutRate > 0 ? '<tr><td class="dim">AH cut (' + state.ahCut + '%)</td><td class="num mono dim">−' + fmt(cutAmt) + '</td></tr>' : ''),
    '<tr><td class="dim">' + (state.sellmode === 'ah' ? 'Net sale (AH)' : 'Sale (vendor)') + '</td><td class="num mono">' + fmt(c.sell) + '</td></tr>',
    '<tr class="divider"><td>Profit / craft</td><td class="num mono ' + profitCls(c.profit) + '">' + fmt(c.profit) + '</td></tr>',
    '<tr><td>Profit / hour</td><td class="num mono ' + profitCls(c.perHour) + '">' + fmt(c.perHour) + '</td></tr>',
    '<tr><td>Margin</td><td class="num mono">' + (margin == null ? '—' : (margin >= 0 ? '+' : '') + margin.toFixed(1) + '%') + '</td></tr>',
  ].filter(Boolean).join('');

  const castNote = (r.cast || 0) + 's cast' +
    (r.cd > 0 ? ' · ' + fmtCd(r.cd) + ' cooldown' : (state.overhead ? ' + ' + state.overhead + 's overhead' : ''));

  const cd = r.cd > 0 ? '<span class="badge cooldown">cooldown ' + fmtCd(r.cd) + '</span>' : '';

  el.innerHTML =
    '<div class="detail-head">' +
      '<button class="close" title="Close (Esc)" aria-label="Close">✕</button>' +
      '<h2>' + esc(r.n) + badge(r) + '</h2>' +
      '<div class="meta">' + esc(r.p) + ' · skill ' + (r.s > 0 ? r.s : '?') + (r.t ? '–' + r.t : '') + ' · ' +
        (r.c ? esc(r.c) + ' · ' : '') + 'obtained via <span class="src-tag ' + r.src + '">' + (SRC_LABEL[r.src] || r.src) + '</span> ' + cd + '</div>' +
    '</div>' +
    '<div class="detail-cols">' +
      '<div class="detail-left">' +
        '<h3>Materials</h3>' +
        '<table class="reagents"><thead><tr><th>Reagent</th><th class="num">Qty</th><th>Source</th><th class="num">Unit</th><th class="num">Total</th></tr></thead><tbody>' + matRows + '</tbody></table>' +
        '<h3>Output</h3>' +
        '<table class="reagents"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Sell price</th></tr></thead><tbody>' + outRows + '</tbody></table>' +
      '</div>' +
      '<div class="profit-panel">' +
        '<h3>Profit</h3>' +
        '<table class="breakdown"><tbody>' + pRows + '</tbody></table>' +
        '<p class="craft-note">' + castNote + ' · buying at ' + (state.matmode === 'min' ? 'cheapest' : state.matmode) + ' · selling to ' + state.sellmode + '</p>' +
      '</div>' +
    '</div>';

  bindEditable(el);
  const close = el.querySelector('.close');
  if (close) close.addEventListener('click', () => { state.selected = null; renderAll(); });
}

// Click-to-edit price cells: click a Unit/Sell price to set a manual override.
function bindEditable(root) {
  root.querySelectorAll('td.editable').forEach((cell) => {
    cell.addEventListener('click', () => {
      if (cell.querySelector('input')) return;
      const id = cell.dataset.id;
      const field = cell.dataset.field;
      const ov = cell.dataset.ov ? parseInt(cell.dataset.ov, 10) : null;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = ov == null ? '' : fmt(ov);
      inp.placeholder = 'auto';
      cell.textContent = '';
      cell.appendChild(inp);
      inp.focus();
      inp.select();
      const commit = () => {
        const v = parseMoney(inp.value);
        if (!priceStore[id]) priceStore[id] = {};
        if (v == null) delete priceStore[id][field];
        else priceStore[id][field] = v;
        if (!priceStore[id].buy && !priceStore[id].sell) delete priceStore[id];
        savePrices();
        renderAll();
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') inp.blur();
        else if (e.key === 'Escape') { inp.value = ''; inp.blur(); }
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function savePrices() {
  try { localStorage.setItem(LS_PRICES, JSON.stringify(priceStore)); } catch (e) {}
}
function loadPrices() {
  try {
    const s = localStorage.getItem(LS_PRICES);
    if (s) priceStore = JSON.parse(s) || {};
  } catch (e) { priceStore = {}; }
}
function saveSettings() {
  const s = { rep: state.rep, barter: state.barter, ahCut: state.ahCut, matmode: state.matmode, sellmode: state.sellmode, overhead: state.overhead, realm: state.realm, basis: state.basis };
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch (e) {}
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}');
    Object.assign(state, s);
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Live AH prices (ahprice.com)
// ---------------------------------------------------------------------------
const AH_API = 'https://ahprice.com/api/v1';

function factionOf(realm) {
  const parts = String(realm).split('-');
  return parts[parts.length - 1] || 'alliance';
}

async function loadRealms() {
  try {
    const data = await loadJSON(AH_API + '/realms');
    const realms = (data.realms || []).filter((r) => !r.is_beta);
    const byRegion = {};
    for (const r of realms) (byRegion[r.region] = byRegion[r.region] || []).push(r);

    const sel = $('realm');
    sel.innerHTML = '';
    for (const region of Object.keys(byRegion).sort()) {
      const group = document.createElement('optgroup');
      group.label = region;
      for (const r of byRegion[region].sort((a, b) => a.label.localeCompare(b.label))) {
        const o = document.createElement('option');
        o.value = r.market_id;
        o.textContent = r.label + (r.last_scan_age_text ? ' · ' + r.last_scan_age_text : '');
        group.appendChild(o);
      }
      sel.appendChild(group);
    }

    if (!state.realm && sel.options.length) state.realm = sel.options[0].value;
    sel.value = state.realm;
    loadCachedLive(state.realm);
    updateAhStatus();
  } catch (e) {
    $('ahStatus').textContent = 'Could not load markets (offline?). Load prices by entering them manually below.';
  }
}

async function loadAhPrices() {
  const realm = state.realm;
  if (!realm) return;
  const faction = factionOf(realm);
  const btn = $('loadAh');
  btn.disabled = true;
  $('ahStatus').textContent = 'Loading live AH prices…';

  // Unique item ids across all recipes (reagents + outputs).
  const ids = new Set();
  for (const r of RECIPES) {
    for (const rg of r.rg) ids.add(rg.i);
    for (const o of r.out) ids.add(o.i);
  }
  const idList = [...ids];
  const CHUNK = 50;
  const chunks = [];
  for (let i = 0; i < idList.length; i += CHUNK) chunks.push(idList.slice(i, i + CHUNK));

  const map = {};
  const names = {};

  try {
    let done = 0;
    const CONCURRENCY = 6;
    let cursor = 0;
    async function worker() {
      while (cursor < chunks.length) {
        const chunk = chunks[cursor++];
        const url = AH_API + '/prices?ids=' + chunk.join(',') + '&realm=' + encodeURIComponent(realm) + '&faction=' + faction;
        try {
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (res.ok) {
            const j = await res.json();
            for (const it of j.items || []) {
              const id = String(it.item_id);
              map[id] = { f: num(it.latest_floor_copper), a: num(it.market_avg_copper), t: num(it.true_value_copper), q: it.latest_floor_qty != null ? num(it.latest_floor_qty) : null, n: num(it.samples) };
              if (it.name && !UNRESOLVED_RE.test(it.name)) names[id] = it.name;
            }
          }
        } catch (e) { /* skip this chunk */ }
        done += chunk.length;
        $('ahStatus').textContent = 'Loading live AH prices… ' + done + '/' + idList.length;
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    livePrices = map;
    liveNames = names;
    liveMeta = { realm, fetchedAt: Date.now(), count: Object.keys(map).length };
    saveLive();
    updateAhStatus();
    renderAll();
  } catch (e) {
    $('ahStatus').textContent = 'Failed to load prices: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

function num(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

function liveCacheKey(realm) { return 'wowf-live-v2-' + realm; }

function saveLive() {
  try {
    localStorage.setItem(liveCacheKey(liveMeta.realm), JSON.stringify({ realm: liveMeta.realm, fetchedAt: liveMeta.fetchedAt, count: liveMeta.count, prices: livePrices, names: liveNames }));
  } catch (e) {}
}

function loadCachedLive(realm) {
  try {
    const s = localStorage.getItem(liveCacheKey(realm));
    if (s) {
      const d = JSON.parse(s);
      livePrices = d.prices || {};
      liveNames = d.names || {};
      liveMeta = { realm: d.realm, fetchedAt: d.fetchedAt, count: d.count || Object.keys(livePrices).length };
      return;
    }
  } catch (e) {}
  livePrices = {};
  liveNames = {};
  liveMeta = null;
}

function updateAhStatus() {
  const el = $('ahStatus');
  if (!liveMeta) {
    el.textContent = 'No prices loaded — click “Load live AH prices”.';
    return;
  }
  const age = Math.round((Date.now() - liveMeta.fetchedAt) / 60000);
  el.textContent = liveMeta.count + ' items priced · ' + (age < 1 ? 'just now' : age + ' min ago') + ' · ' + basisLabel();
}

function basisLabel() {
  return state.basis === 'avg' ? 'market avg' : state.basis === 'true' ? 'true value' : 'lowest buyout';
}

// ---------------------------------------------------------------------------
// Controls wiring
// ---------------------------------------------------------------------------
function wireControls() {
  const bind = (id, ev, fn) => $(id).addEventListener(ev, fn);

  bind('search', 'input', (e) => { state.search = e.target.value; renderAll(); });
  bind('prof', 'change', (e) => { state.prof = e.target.value; renderAll(); });
  bind('source', 'change', (e) => { state.source = e.target.value; renderAll(); });
  bind('skillMin', 'input', (e) => { state.skillMin = Math.max(0, parseInt(e.target.value) || 0); renderAll(); });
  bind('skillMax', 'input', (e) => { state.skillMax = parseInt(e.target.value) || 400; renderAll(); });

  bind('rep', 'change', (e) => { state.rep = parseInt(e.target.value) || 0; saveSettings(); renderAll(); });
  bind('barter', 'change', (e) => { state.barter = parseInt(e.target.value) || 0; saveSettings(); renderAll(); });
  bind('ahcut', 'change', (e) => { state.ahCut = parseInt(e.target.value) || 0; saveSettings(); renderAll(); });
  bind('matmode', 'change', (e) => { state.matmode = e.target.value; saveSettings(); renderAll(); });
  bind('sellmode', 'change', (e) => { state.sellmode = e.target.value; saveSettings(); renderAll(); });
  bind('overhead', 'input', (e) => { state.overhead = parseFloat(e.target.value) || 0; saveSettings(); renderAll(); });
  bind('onlyProfit', 'change', (e) => { state.onlyProfit = e.target.checked; renderAll(); });
  bind('hideMissing', 'change', (e) => { state.hideMissing = e.target.checked; renderAll(); });

  bind('realm', 'change', (e) => { state.realm = e.target.value; saveSettings(); loadCachedLive(state.realm); updateAhStatus(); renderAll(); });
  bind('basis', 'change', (e) => { state.basis = e.target.value; saveSettings(); updateAhStatus(); renderAll(); });
  bind('loadAh', 'click', loadAhPrices);

  document.querySelectorAll('thead th.sortable').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.dataset.sort;
      if (state.sort.key === key) state.sort.dir *= -1;
      else state.sort = { key, dir: key === 'n' || key === 'p' || key === 'src' ? 1 : -1 };
      renderAll();
    });
  });
}

function populateProfessions() {
  const set = new Set();
  for (const r of RECIPES) set.add(r.p);
  const sel = $('prof');
  for (const p of [...set].sort()) {
    const o = document.createElement('option');
    o.value = p; o.textContent = p;
    sel.appendChild(o);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load ' + url + ' (status ' + res.status + ')');
  return res.json();
}

async function init() {
  try {
    const [recipes, materials, vendor, sellPrices] = await Promise.all([
      loadJSON('data/recipes.json'),
      loadJSON('data/materials.json'),
      loadJSON('data/vendor-prices.json'),
      loadJSON('data/vendor-sell.json'),
    ]);
    RECIPES = recipes;
    ID2NAME = materials;
    VENDOR_SELL = sellPrices || {};
    BUILD = '1.60.1.69876';
    DATA_DATE = '2026-09-17';

    // Build name -> id(s) lookup for vendor seed matching.
    for (const id of Object.keys(materials)) {
      const n = materials[id].toLowerCase();
      (NAME2IDS[n] = NAME2IDS[n] || []).push(id);
    }
    for (const name of Object.keys(vendor.items)) {
      const ids = NAME2IDS[name.toLowerCase()];
      if (ids) for (const id of ids) VENDOR_SEED[id] = vendor.items[name];
    }

    $('buildNote').textContent = 'Client build ' + BUILD + ' · recipe snapshot ' + DATA_DATE + ' (beta) · ' + RECIPES.length + ' recipes';
    $('footBuild').textContent = BUILD;

    loadSettings();
    loadPrices();
    populateProfessions();
    wireControls();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.selected != null) { state.selected = null; renderAll(); }
    });
    // Apply persisted setting values to the controls.
    $('rep').value = state.rep;
    $('barter').value = state.barter;
    $('ahcut').value = state.ahCut;
    $('matmode').value = state.matmode;
    $('sellmode').value = state.sellmode;
    $('overhead').value = state.overhead;
    $('basis').value = state.basis;
    renderAll();
    loadRealms();
  } catch (err) {
    document.body.insertAdjacentHTML('beforeend',
      '<div style="padding:30px;color:var(--bad)"><h2>Could not load data</h2><p>' + esc(err.message) +
      '</p><p>This is a static site — open it through a local web server (for example <code>python -m http.server</code>) or deploy to GitHub Pages.</p></div>');
  }
}

document.addEventListener('DOMContentLoaded', init);
