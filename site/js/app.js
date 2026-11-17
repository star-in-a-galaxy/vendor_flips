import { moneyHTML, moneyText, parseMoney } from './money.js';
import { loadMarkets, loadPrices } from './prices.js';
import { evaluate, ahValue, secondsPerCraft, CRAFT_GAP_S } from './flips.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const wowhead = (id) => `https://www.wowhead.com/forever/item=${id}`;
const SETTINGS_KEY = 'vf:settings';
const mobile = matchMedia('(max-width: 899px)');

const FILTER_DEFAULTS = { skills: {}, minMargin: '', minProfit: '', minHour: '', hideStale: false, gap: CRAFT_GAP_S };
const state = {
  market: null, basis: 'typical', rep: 0, barter: 0,
  profs: [], q: '', losing: false, sort: 'profit', dir: 'desc', moreOpen: false,
  ...structuredClone(FILTER_DEFAULTS),
  selected: null, crafts: 1,
};
const SAVED = ['market', 'basis', 'rep', 'barter', 'profs', 'losing', 'sort', 'dir', 'moreOpen', ...Object.keys(FILTER_DEFAULTS)];

let DATA = null;        // { items, recipes, build }
let MARKETS = [];
let PRICES = null;      // { [id]: [floor, typical, avg, samples, seen] }
let pricesMeta = null;  // { fetchedAt, warning }
let results = [];       // evaluate() for every recipe
let visible = [];       // filtered + sorted subset of results
let searchText = new Map();

// ---------------------------------------------------------------- settings
function loadSettings() {
  try { Object.assign(state, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch { /* defaults */ }
  state.selected = null;
  state.crafts = 1;
  if (!SORT_KEYS[state.sort]) state.sort = 'profit';
  if (state.dir !== 'asc' && state.dir !== 'desc') state.dir = 'desc';
  if (!(state.gap >= 0)) state.gap = CRAFT_GAP_S;
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.fromEntries(SAVED.map((k) => [k, state[k]])))); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- status line
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
}
function marketName(m) { return m ? `${m.region} ${m.label}` : ''; }

function setStatus(html, kind = '') {
  const el = $('status');
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.innerHTML = html;
}
function showPriceStatus() {
  const m = MARKETS.find((x) => x.id === state.market);
  if (!pricesMeta) return;
  let html = `Auction prices for <strong>${esc(marketName(m))}</strong>, fetched ${ago(pricesMeta.fetchedAt)}.`;
  if (m?.lastScan) html += ` Latest AH scan ${ago(Date.parse(m.lastScan))}.`;
  if (pricesMeta.warning) html += ` <span class="warn">Refresh failed: ${esc(pricesMeta.warning)} Showing saved prices.</span>`;
  setStatus(html, pricesMeta.warning ? 'is-warn' : '');
}

// ---------------------------------------------------------------- data loading
async function loadData() {
  const res = await fetch('data/flips.json');
  if (!res.ok) throw new Error(`Recipe data failed to load (${res.status}).`);
  DATA = await res.json();
  $('build').textContent = DATA.build;
  for (const r of DATA.recipes) {
    const names = [r.n, ...r.r.map(([id]) => DATA.items[id]?.n || '')];
    searchText.set(r.id, names.join(' ').toLowerCase());
  }
}

async function initMarkets() {
  const sel = $('market');
  try {
    MARKETS = await loadMarkets();
  } catch (e) {
    sel.innerHTML = '<option>No markets</option>';
    setStatus(`${esc(e.message)} <button type="button" class="link" id="retryMarkets">Try again</button>`, 'is-error');
    $('retryMarkets').addEventListener('click', () => { setStatus('Loading markets…'); initMarkets(); });
    return;
  }
  const order = (m) => (m.region === 'Other' ? 'zz' : m.region);
  const regions = [...new Set(MARKETS.map(order))].sort();
  sel.innerHTML = regions.map((reg) => {
    const ms = MARKETS.filter((m) => order(m) === reg).sort((a, b) => a.label.localeCompare(b.label));
    return `<optgroup label="${esc(ms[0].region)}">${ms.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</optgroup>`;
  }).join('');
  if (!MARKETS.some((m) => m.id === state.market)) state.market = sel.options[0].value;
  sel.value = state.market;
  sel.disabled = false;
  await refreshPrices(false);
}

async function refreshPrices(force) {
  const market = MARKETS.find((m) => m.id === state.market);
  if (!market) return;
  const btn = $('refresh');
  btn.disabled = true;
  setStatus(`Loading auction prices for <strong>${esc(marketName(market))}</strong>…`, 'is-loading');
  try {
    const r = await loadPrices(market, { force });
    PRICES = r.prices;
    pricesMeta = { fetchedAt: r.fetchedAt, warning: r.warning };
    showPriceStatus();
  } catch (e) {
    PRICES = null;
    pricesMeta = null;
    setStatus(`${esc(e.message)}`, 'is-error');
  } finally {
    btn.disabled = false;
  }
  recompute();
}

// ---------------------------------------------------------------- compute + list
function ctx() {
  return { items: DATA.items, prices: PRICES, basis: state.basis, rep: +state.rep, barter: +state.barter, gap: +state.gap, now: Date.now() };
}

function recompute() {
  const c = ctx();
  results = DATA.recipes.map((r) => evaluate(r, c));
  renderList();
  if (state.selected) renderDetail();
}

// Column sorts. First click on a column uses its natural direction, the next click flips it.
const SORT_KEYS = {
  name: { label: 'Recipe', get: (e) => e.recipe.n, first: 'asc' },
  cost: { label: 'Materials', get: (e) => e.cost, first: 'desc' },
  revenue: { label: 'Vendor pays', get: (e) => e.revenue, first: 'desc' },
  profit: { label: 'Profit', get: (e) => e.profit, first: 'desc' },
  hour: { label: 'Profit per hour', get: (e) => e.perHour, first: 'desc' },
  margin: { label: 'Margin', get: (e) => e.margin, first: 'desc' },
};
function compare(a, b) {
  const { get } = SORT_KEYS[state.sort];
  const x = get(a), y = get(b);
  const d = typeof x === 'string' ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity);
  return (state.dir === 'asc' ? d : -d) || b.profit - a.profit || a.recipe.n.localeCompare(b.recipe.n);
}
function dirText(key, dir) {
  if (key === 'name') return dir === 'asc' ? 'A to Z' : 'Z to A';
  return dir === 'asc' ? 'low to high' : 'high to low';
}
function renderSortUI() {
  for (const b of $('listHead').querySelectorAll('.sort')) {
    const key = b.dataset.sort;
    const on = key === state.sort;
    b.classList.toggle('is-sorted', on);
    b.dataset.dir = on ? state.dir : '';
    const next = on ? (state.dir === 'asc' ? 'desc' : 'asc') : SORT_KEYS[key].first;
    b.setAttribute('aria-label', `${SORT_KEYS[key].label}${on ? `, sorted ${dirText(key, state.dir)}` : ''}. Sort ${dirText(key, next)}`);
  }
  $('sort').value = state.sort + ':' + state.dir;
}
function setSort(key, dir) {
  state.sort = key;
  state.dir = dir;
  saveSettings();
  renderSortUI();
  renderList();
}

// "3s", "12.5s", "1 min", "1 h 5 min"
function duration(sec) {
  if (sec < 60) return `${Math.round(sec * 10) / 10}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
function castText(r) {
  return r.cd > 0 ? `${duration(r.cd)} cooldown` : `${duration(r.cast)} cast`;
}

function renderProfs() {
  const profs = professions();
  state.profs = state.profs.filter((p) => profs.includes(p));
  $('profs').innerHTML =
    `<button type="button" class="chip" data-prof="" aria-pressed="${!state.profs.length}">All</button>` +
    profs.map((p) => `<button type="button" class="chip" data-prof="${esc(p)}" aria-pressed="${state.profs.includes(p)}">${esc(p)}</button>`).join('');
}

// ---------------------------------------------------------------- filters
function activeFilters() {
  const skills = Object.fromEntries(Object.entries(state.skills).filter(([, v]) => v !== '' && v != null && +v >= 0).map(([k, v]) => [k, +v]));
  const minMargin = state.minMargin === '' ? null : +state.minMargin / 100;
  const minProfit = parseMoney(state.minProfit);
  const minHour = parseMoney(state.minHour);
  const f = {
    skills,
    minMargin: Number.isFinite(minMargin) ? minMargin : null,
    minProfit: Number.isFinite(minProfit) ? minProfit : null,
    minHour: Number.isFinite(minHour) ? minHour : null,
    hideStale: !!state.hideStale,
  };
  f.count = Object.keys(skills).length + (f.minMargin != null) + (f.minProfit != null) + (f.minHour != null) + f.hideStale;
  return f;
}
function passes(e, f) {
  const r = e.recipe;
  const skill = f.skills[r.p];
  if (skill != null && r.sk != null && r.sk > skill) return false;
  if (f.minMargin != null && !(e.margin >= f.minMargin)) return false;
  if (f.minProfit != null && !(e.profit >= f.minProfit)) return false;
  if (f.minHour != null && !(e.perHour >= f.minHour)) return false;
  if (f.hideStale && e.stale) return false;
  return true;
}
function professions() {
  return [...new Set(DATA.recipes.map((r) => r.p))].sort();
}
function renderFilters() {
  $('skills').innerHTML = professions().map((p, i) =>
    `<label for="skill-${i}">${esc(p)}<input type="number" id="skill-${i}" data-prof="${esc(p)}" min="0" max="450" step="1" inputmode="numeric" placeholder="any" value="${esc(state.skills[p] ?? '')}"></label>`).join('');
  $('minMargin').value = state.minMargin;
  $('minProfit').value = state.minProfit;
  $('minHour').value = state.minHour;
  $('hideStale').checked = !!state.hideStale;
  $('gap').value = state.gap;
  $('more').open = !!state.moreOpen;
  $('sort').innerHTML = Object.entries(SORT_KEYS).flatMap(([key, { label, first }]) =>
    [first, first === 'asc' ? 'desc' : 'asc'].map((dir) => `<option value="${key}:${dir}">${label}, ${dirText(key, dir)}</option>`)).join('');
  updateFilterUI();
}
function updateFilterUI() {
  const f = activeFilters();
  $('moreCount').textContent = f.count ? `(${f.count} on)` : '';
  for (const id of ['minProfit', 'minHour']) {
    const bad = Number.isNaN(parseMoney(state[id]));
    $(id).setAttribute('aria-invalid', String(bad));
    $(id + 'Err').textContent = bad ? 'Use g, s and c, for example 1g 20s.' : '';
  }
}

function renderList() {
  const list = $('list');
  const note = $('listNote');
  if (!PRICES) {
    list.innerHTML = '';
    note.textContent = 'Flips appear once auction prices for your market have loaded.';
    hideDetail();
    return;
  }
  const q = state.q.trim().toLowerCase();
  const inScope = results.filter((e) =>
    (!state.profs.length || state.profs.includes(e.recipe.p)) &&
    (!q || searchText.get(e.recipe.id).includes(q)));
  const unpriced = inScope.filter((e) => e.profit == null).length;
  const f = activeFilters();
  visible = inScope.filter((e) => e.profit != null && (state.losing || e.profit > 0) && passes(e, f)).sort(compare);

  list.innerHTML = visible.map((e) => {
    const r = e.recipe;
    const out = DATA.items[r.o[0]];
    const yieldText = r.o[1] !== 1 ? ` <span class="yield">makes ${r.o[1]}</span>` : '';
    const pct = e.margin == null ? '—' : `${Math.round(e.margin * 100)}%`;
    return `<li><button type="button" class="row${e.profit > 0 ? '' : ' is-loss'}" data-id="${r.id}" aria-current="${r.id === state.selected}">
      <span class="r-name"><span class="r-title">${esc(r.n)}</span><span class="r-sub">${esc(r.p)}${r.sk ? `, skill ${r.sk}` : ''}, ${castText(r)}${yieldText}${out && out.n !== r.n ? `, ${esc(out.n)}` : ''}</span></span>
      <span class="num" data-label="Materials">${moneyHTML(e.cost)}</span>
      <span class="num" data-label="Vendor pays">${moneyHTML(e.revenue)}</span>
      <span class="num profit" data-label="Profit">${moneyHTML(e.profit)}</span>
      <span class="num hour" data-label="Per hour">${moneyHTML(e.perHour)}</span>
      <span class="num pct" data-label="Margin">${pct}</span>
    </button></li>`;
  }).join('');

  // Account for every recipe in scope: profitable, losing (hidden unless asked), unpriced.
  const parts = [];
  const priced = inScope.filter((e) => e.profit != null && passes(e, f));
  const wins = priced.filter((e) => e.profit > 0).length;
  const losses = priced.length - wins;
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  parts.push(`${n(wins, 'profitable flip', 'profitable flips')} right now.`);
  if (losses) parts.push(state.losing
    ? `Also showing ${n(losses, 'craft that loses', 'crafts that lose')} money.`
    : `${n(losses, 'more craft loses', 'more crafts lose')} money and ${losses === 1 ? 'is' : 'are'} hidden; tick Show crafts that lose money to see ${losses === 1 ? 'it' : 'them'}.`);
  if (unpriced) parts.push(`${n(unpriced, 'more recipe has', 'more recipes have')} no price: a material has no AH listings and no vendor price.`);
  if (f.count && visible.length) parts.push(`${f.count} extra filter${f.count === 1 ? '' : 's'} on, see More filters.`);
  if (!visible.length) parts.unshift(q || state.profs.length || f.count ? 'Nothing matches these filters.' : 'No crafts sell to a vendor for more than they cost at these prices.');
  note.textContent = parts.join(' ');

  // Keep the selection if it is still listed, else select the top flip on wide screens.
  if (!visible.some((e) => e.recipe.id === state.selected)) {
    const fromHash = +location.hash.slice(1);
    const pick = visible.find((e) => e.recipe.id === fromHash) || (mobile.matches ? null : visible[0]);
    if (pick) select(pick.recipe.id, { focus: false, open: false });
    else hideDetail();
  }
}

// ---------------------------------------------------------------- detail
function select(id, { focus = false, open = true } = {}) {
  if (state.selected !== id) state.crafts = 1;
  state.selected = id;
  for (const b of $('list').querySelectorAll('.row')) b.setAttribute('aria-current', String(+b.dataset.id === id));
  history.replaceState(null, '', '#' + id);
  renderDetail();
  const d = $('detail');
  d.hidden = false;
  if (mobile.matches && open) {
    d.classList.add('is-open');
    document.body.classList.add('sheet-open');
    if (focus) $('closeDetail')?.focus();
  }
}

function hideDetail() {
  state.selected = null;
  $('detail').hidden = true;
  closeSheet();
}

function closeSheet() {
  const d = $('detail');
  if (!d.classList.contains('is-open')) return;
  d.classList.remove('is-open');
  document.body.classList.remove('sheet-open');
  $('list').querySelector(`.row[data-id="${state.selected}"]`)?.focus();
}

function shoppingText(e, n) {
  const r = e.recipe;
  const lines = e.lines.map((l) => `${l.qty * n}x ${DATA.items[l.id]?.n} (${l.source === 'vendor' ? 'vendor' : 'AH'}, ${moneyText(l.price)} each)`);
  return [`${r.n} x${n}`, ...lines, `Materials ${moneyText(e.cost * n)}, vendor pays ${moneyText(e.revenue * n)}, profit ${moneyText(e.profit * n)}`].join('\n');
}

function renderDetail() {
  const e = results.find((x) => x.recipe.id === state.selected);
  if (!e) return;
  const r = e.recipe;
  const n = state.crafts;
  const out = DATA.items[r.o[0]];
  const c = ctx();
  const ah = ahValue(r.o[0], c);
  const sellEach = out?.s || 0;

  const rows = e.lines.map((l) => {
    const it = DATA.items[l.id] || { n: `Item ${l.id}` };
    const where = l.source === 'vendor' ? 'Vendor' : l.source === 'ah' ? 'Auction house' : 'No price';
    const alt = l.source === 'vendor' && l.ah ? `AH ${moneyText(l.ah)}` : l.source === 'ah' && l.vendor ? `Vendor ${moneyText(l.vendor)}` : '';
    return `<tr${l.stale ? ' class="is-stale"' : ''}>
      <th scope="row"><a href="${wowhead(l.id)}" target="_blank" rel="noopener">${esc(it.n)}</a>${l.stale ? '<span class="tag">old price</span>' : ''}</th>
      <td class="num">${l.qty * n}</td>
      <td>${where}${alt ? `<span class="alt">${esc(alt)}</span>` : ''}</td>
      <td class="num">${moneyHTML(l.price)}</td>
      <td class="num">${moneyHTML(l.price == null ? null : l.price * l.qty * n)}</td>
    </tr>`;
  }).join('');

  const notes = [];
  if (ah && ah > sellEach * 1.15) notes.push(`This item sells for about ${moneyText(ah)} each on the auction house, more than the vendor pays.`);
  if (e.stale) notes.push('Prices marked old were last seen on the auction house more than 3 days ago and may be gone.');
  if (state.basis === 'floor') notes.push('Lowest listings often have only a few units. Larger batches usually cost more.');
  notes.push(r.cd > 0
    ? `This recipe has a ${duration(r.cd)} cooldown, so per hour counts one craft per cooldown.`
    : `Per hour assumes ${duration(r.cast)} cast plus ${+state.gap}s between crafts (set in More filters). Buying materials and visiting the vendor are not counted.`);

  const pct = e.margin == null ? '—' : `${Math.round(e.margin * 100)}%`;
  $('detailInner').innerHTML = `
    <button type="button" class="btn close" id="closeDetail">Back to list</button>
    <p class="d-sub">${esc(r.p)}${r.sk ? `, learn at skill ${r.sk}` : ''}</p>
    <h2 id="detail-title" class="d-title"><a href="${wowhead(r.o[0])}" target="_blank" rel="noopener">${esc(r.n)}</a></h2>
    ${out && out.n !== r.n ? `<p class="d-sub">Makes ${esc(out.n)}</p>` : ''}

    <div class="d-profit${e.profit > 0 ? '' : ' is-loss'}">
      <p class="d-big">${moneyHTML(e.profit == null ? null : e.profit * n)}</p>
      <p class="d-big-label">profit for ${n} craft${n === 1 ? '' : 's'}, ${pct} margin</p>
      <p class="d-hour">${moneyHTML(e.perHour)} <span>per hour of crafting back to back</span></p>
    </div>

    <div class="d-crafts">
      <label for="crafts">Crafts</label>
      <button type="button" class="btn step" data-step="-1" aria-label="One fewer craft">−</button>
      <input type="number" id="crafts" min="1" max="999" value="${n}" inputmode="numeric">
      <button type="button" class="btn step" data-step="1" aria-label="One more craft">+</button>
      <span class="d-yield">Makes ${r.o[1] * n} ${esc(out?.n || '')}, vendor pays ${moneyText(sellEach)} each. ${n === 1 ? 'Takes' : `${n} crafts take`} about ${duration(secondsPerCraft(r) * n)}.</span>
    </div>

    <table class="shop">
      <caption>Shopping list</caption>
      <thead><tr><th scope="col">Material</th><th scope="col" class="num">Need</th><th scope="col">Buy from</th><th scope="col" class="num">Each</th><th scope="col" class="num">Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><th scope="row" colspan="4">Materials</th><td class="num">${moneyHTML(e.cost == null ? null : e.cost * n)}</td></tr>
        <tr><th scope="row" colspan="4">Vendor pays</th><td class="num">${moneyHTML(e.revenue * n)}</td></tr>
        <tr class="t-profit"><th scope="row" colspan="4">Profit</th><td class="num">${moneyHTML(e.profit == null ? null : e.profit * n)}</td></tr>
      </tfoot>
    </table>

    ${notes.length ? `<ul class="d-notes">${notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}

    <p class="d-actions">
      <button type="button" class="btn primary" id="copyList">Copy shopping list</button>
      <span class="copied" id="copied" role="status"></span>
    </p>`;
}

// ---------------------------------------------------------------- events
function bind() {
  const onSetting = (key, el, after = recompute) => el.addEventListener('change', () => { state[key] = el.value; saveSettings(); after(); });
  for (const k of ['basis', 'rep', 'barter']) { $(k).value = String(state[k]); }
  onSetting('basis', $('basis'));
  onSetting('rep', $('rep'));
  onSetting('barter', $('barter'));

  $('sort').addEventListener('change', (ev) => { const [k, d] = ev.target.value.split(':'); setSort(k, d); });
  $('listHead').addEventListener('click', (ev) => {
    const b = ev.target.closest('.sort');
    if (!b) return;
    const key = b.dataset.sort;
    setSort(key, key === state.sort ? (state.dir === 'asc' ? 'desc' : 'asc') : SORT_KEYS[key].first);
  });

  // More filters: typing re-filters after a short pause; the gap changes the math.
  let ft;
  const filterChanged = (after = renderList) => { saveSettings(); updateFilterUI(); clearTimeout(ft); ft = setTimeout(after, 150); };
  $('more').addEventListener('toggle', () => { state.moreOpen = $('more').open; saveSettings(); });
  $('skills').addEventListener('input', (ev) => {
    const p = ev.target.dataset.prof;
    if (!p) return;
    if (ev.target.value === '') delete state.skills[p]; else state.skills[p] = ev.target.value;
    filterChanged();
  });
  for (const id of ['minMargin', 'minProfit', 'minHour']) $(id).addEventListener('input', (ev) => { state[id] = ev.target.value.trim(); filterChanged(); });
  $('hideStale').addEventListener('change', (ev) => { state.hideStale = ev.target.checked; filterChanged(); });
  $('gap').addEventListener('input', (ev) => {
    const v = parseFloat(ev.target.value);
    if (!(v >= 0 && v <= 10)) return;
    state.gap = v;
    filterChanged(recompute);
  });
  $('resetFilters').addEventListener('click', () => {
    Object.assign(state, structuredClone(FILTER_DEFAULTS));
    saveSettings();
    renderFilters();
    recompute();
  });
  $('market').addEventListener('change', (ev) => { state.market = ev.target.value; saveSettings(); refreshPrices(false); });
  $('refresh').addEventListener('click', () => refreshPrices(true));

  $('losing').checked = !!state.losing;
  $('losing').addEventListener('change', (ev) => { state.losing = ev.target.checked; saveSettings(); renderList(); });

  let t;
  $('search').addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(() => { state.q = ev.target.value; renderList(); }, 120); });

  $('profs').addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip');
    if (!b) return;
    const p = b.dataset.prof;
    state.profs = !p ? [] : state.profs.includes(p) ? state.profs.filter((x) => x !== p) : [...state.profs, p];
    saveSettings();
    renderProfs();
    renderList();
  });

  $('list').addEventListener('click', (ev) => {
    const b = ev.target.closest('.row');
    if (b) select(+b.dataset.id, { focus: true });
  });
  $('list').addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const rows = [...$('list').querySelectorAll('.row')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    ev.preventDefault();
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))];
    next.focus();
    if (!mobile.matches) select(+next.dataset.id);
  });

  const detail = $('detail');
  detail.addEventListener('click', async (ev) => {
    if (ev.target.closest('#closeDetail')) return closeSheet();
    const step = ev.target.closest('.step');
    if (step) { setCrafts(state.crafts + +step.dataset.step); return; }
    if (ev.target.closest('#copyList')) {
      const e = results.find((x) => x.recipe.id === state.selected);
      try {
        await navigator.clipboard.writeText(shoppingText(e, state.crafts));
        $('copied').textContent = 'Copied';
      } catch {
        $('copied').textContent = 'Your browser blocked the clipboard.';
      }
      setTimeout(() => { if ($('copied')) $('copied').textContent = ''; }, 2500);
    }
  });
  detail.addEventListener('change', (ev) => { if (ev.target.id === 'crafts') setCrafts(parseInt(ev.target.value, 10)); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheet(); });
  mobile.addEventListener('change', () => { if (!mobile.matches) closeSheet(); });
}

function setCrafts(n) {
  state.crafts = Math.min(999, Math.max(1, Number.isFinite(n) ? n : 1));
  const had = document.activeElement?.id;
  renderDetail();
  if (had === 'crafts') $('crafts').focus();
}

// ---------------------------------------------------------------- start
(async function start() {
  loadSettings();
  try {
    await loadData();
  } catch (e) {
    setStatus(esc(e.message) + ' Reload the page to try again.', 'is-error');
    return;
  }
  renderProfs();
  renderFilters();
  renderSortUI();
  bind();
  setStatus('Loading markets…', 'is-loading');
  await initMarkets();
  // Keep the "fetched N minutes ago" text honest while the tab stays open.
  setInterval(() => { if (pricesMeta) showPriceStatus(); }, 60000);
})();
