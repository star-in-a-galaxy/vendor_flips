// Flip math. All money is integer copper.
//
//   unit cost  = cheaper of (vendor price after discounts) and (AH price on the chosen basis)
//   cost       = sum(unit cost x quantity) over the reagents
//   revenue    = vendor sell price x expected yield
//   profit     = revenue - cost

export const MIN_SAMPLES = 3; // fewer AH observations than this and the price is not trusted
export const STALE_MS = 3 * 24 * 60 * 60 * 1000; // an AH price not seen for 3 days is old
// Gap between crafts with "Create All". The global cooldown (1.5s) runs out during the
// cast (every craft cast is 3s or longer), so the gap is mostly latency. Adjustable in the page.
export const CRAFT_GAP_S = 0.3;

// Seconds one craft occupies when crafting back to back. Cooldown recipes (transmutes)
// are limited by the cooldown instead.
export function secondsPerCraft(recipe, gap = CRAFT_GAP_S) {
  const busy = (recipe.cast || 0) + gap;
  return recipe.cd > 0 ? Math.max(recipe.cd, busy) : busy;
}

// ctx: { items, prices, basis: 'typical'|'floor', rep, barter, gap, now }
export function materialPrice(id, ctx) {
  const item = ctx.items[id] || {};
  const vendor = item.b != null ? Math.round(item.b * (1 - ctx.rep) * (1 - ctx.barter)) : null;

  let ah = null, stale = false, samples = 0;
  const p = ctx.prices?.[id];
  if (p && p[3] >= MIN_SAMPLES) {
    const [floor, typical, avg] = p;
    ah = ctx.basis === 'floor' ? (floor || typical || avg) : (typical || avg || floor);
    if (!ah) ah = null;
    stale = p[4] > 0 && ctx.now - p[4] > STALE_MS;
    samples = p[3];
  }

  if (vendor == null && ah == null) return { price: null, source: null, vendor, ah, stale };
  const source = vendor != null && (ah == null || vendor <= ah) ? 'vendor' : 'ah';
  return { price: source === 'vendor' ? vendor : ah, source, vendor, ah, stale: source === 'ah' && stale, samples };
}

// AH value of the crafted item, to tell when the AH would pay more than the vendor.
export function ahValue(id, ctx) {
  const p = ctx.prices?.[id];
  if (!p || p[3] < MIN_SAMPLES) return null;
  return p[1] || p[2] || p[0] || null;
}

export function evaluate(recipe, ctx) {
  const lines = [];
  let cost = 0, missing = 0, stale = 0;
  for (const [id, qty] of recipe.r) {
    const m = materialPrice(id, ctx);
    if (m.price == null) missing++;
    else cost += m.price * qty;
    if (m.stale) stale++;
    lines.push({ id, qty, ...m });
  }
  const [outId, yieldQty] = recipe.o;
  const revenue = Math.round((ctx.items[outId]?.s || 0) * yieldQty);
  const priced = missing === 0;
  const profit = priced ? revenue - cost : null;
  const margin = priced && cost > 0 ? profit / cost : null;
  const perHour = priced ? Math.round((profit * 3600) / secondsPerCraft(recipe, ctx.gap ?? CRAFT_GAP_S)) : null;
  return { recipe, lines, cost: priced ? cost : null, revenue, profit, margin, perHour, missing, stale };
}
