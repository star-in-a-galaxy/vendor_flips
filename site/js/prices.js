// Auction house prices from ahprice.com (WoW Forever only).
//
// The API allows 60 requests a minute and 2000 a day per IP, and the CSV export about 12
// downloads an hour. The whole market comes in ONE export request, cached in localStorage.

const API = 'https://ahprice.com/api/v1';
const MARKETS_KEY = 'vf:markets';
const MARKETS_TTL = 60 * 60 * 1000; // 1 hour
export const PRICES_TTL = 30 * 60 * 1000; // 30 minutes; markets are scanned every 20-60 min
const priceKey = (market) => 'vf:prices:' + market;

function readCache(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeCache(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: run uncached */ }
}

async function getText(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'text/csv, application/json' } });
  } catch {
    throw new Error('Could not reach ahprice.com. Check your connection and try again.');
  }
  if (res.status === 429) {
    const wait = parseInt(res.headers.get('Retry-After') || '', 10);
    const when = wait > 0 ? `in ${wait < 90 ? 'a minute' : `${Math.ceil(wait / 60)} minutes`}` : 'in a few minutes';
    throw new Error(`ahprice.com allows about 12 price downloads an hour and that limit is used up. Try again ${when}.`);
  }
  if (!res.ok) throw new Error(`ahprice.com answered with an error (${res.status}). Try again in a few minutes.`);
  return res.text();
}

// [{ id, label, region, faction, lastScan }]
export async function loadMarkets() {
  const cached = readCache(MARKETS_KEY);
  if (cached && Date.now() - cached.at < MARKETS_TTL) return cached.markets;
  try {
    const data = JSON.parse(await getText(API + '/realms'));
    const markets = (data.realms || [])
      .filter((r) => !r.is_beta)
      .map((r) => ({ id: r.market_id, label: r.label, region: r.region, faction: r.faction, lastScan: r.last_scan_at }));
    if (!markets.length) throw new Error('ahprice.com returned no markets.');
    writeCache(MARKETS_KEY, { at: Date.now(), markets });
    return markets;
  } catch (e) {
    if (cached) return cached.markets; // stale list beats no list
    throw e;
  }
}

// Minimal RFC 4180 line splitter (item names can contain commas and quotes).
function splitLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// CSV text -> { [itemId]: [floor, typical, avg, samples, lastSeenMs] }
export function parsePriceCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = splitLine(lines.shift() || '');
  const col = (name) => head.indexOf(name);
  const iId = col('item_id'), iFloor = col('latest_floor_copper'), iTv = col('true_value_copper'),
    iAvg = col('market_avg_copper'), iN = col('samples'), iSeen = col('last_seen_at');
  if (iId < 0 || iFloor < 0) throw new Error('The price file from ahprice.com has an unexpected format.');
  const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
  const prices = {};
  for (const line of lines) {
    const f = splitLine(line);
    const id = f[iId];
    if (!id) continue;
    const seen = iSeen >= 0 ? Date.parse(f[iSeen]) : NaN;
    prices[id] = [num(f[iFloor]), iTv >= 0 ? num(f[iTv]) : 0, iAvg >= 0 ? num(f[iAvg]) : 0, iN >= 0 ? num(f[iN]) : 0, Number.isFinite(seen) ? seen : 0];
  }
  return prices;
}

// { prices, fetchedAt, cached: bool, warning?: string }
export async function loadPrices(market, { force = false } = {}) {
  const cached = readCache(priceKey(market.id));
  if (!force && cached && Date.now() - cached.fetchedAt < PRICES_TTL) {
    return { prices: cached.prices, fetchedAt: cached.fetchedAt, cached: true };
  }
  try {
    const url = `${API}/export/prices.csv?realm=${encodeURIComponent(market.id)}&faction=${encodeURIComponent(market.faction)}`;
    const prices = parsePriceCsv(await getText(url));
    if (!Object.keys(prices).length) throw new Error('ahprice.com has no prices for this market yet.');
    const entry = { fetchedAt: Date.now(), prices };
    writeCache(priceKey(market.id), entry);
    return { ...entry, cached: false };
  } catch (e) {
    if (cached) return { prices: cached.prices, fetchedAt: cached.fetchedAt, cached: true, warning: e.message };
    throw e;
  }
}
