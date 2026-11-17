// Copper integers in, WoW-style gold/silver/copper out.

export function splitCopper(copper) {
  const abs = Math.round(Math.abs(copper));
  return { neg: copper < 0, g: Math.floor(abs / 10000), s: Math.floor((abs % 10000) / 100), c: abs % 100 };
}

// Plain text: "12g 3s 40c", "-50s", "0c".
export function moneyText(copper) {
  if (copper == null || !isFinite(copper)) return '—';
  const { neg, g, s, c } = splitCopper(copper);
  const parts = [];
  if (g) parts.push(g + 'g');
  if (s) parts.push(s + 's');
  if (c || !parts.length) parts.push(c + 'c');
  return (neg ? '-' : '') + parts.join(' ');
}

// "1g 20s", "50s", "1g20s5c", "2" (a bare number is gold) -> copper. Blank -> null, junk -> NaN.
export function parseMoney(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/,/g, '.');
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 10000);
  const re = /(\d+(?:\.\d+)?)\s*([gsc])/g;
  let total = 0, used = '', m;
  while ((m = re.exec(t))) { total += parseFloat(m[1]) * { g: 10000, s: 100, c: 1 }[m[2]]; used += m[0]; }
  return used.replace(/\s/g, '') === t.replace(/\s/g, '') && used ? Math.round(total) : NaN;
}

// HTML with coin markers. Zero units are left out, as in the game (8g, not 8g 0s).
export function moneyHTML(copper) {
  if (copper == null || !isFinite(copper)) return '<span class="money none">—</span>';
  const { neg, g, s, c } = splitCopper(copper);
  const out = [];
  if (g) out.push(`<span class="coin g">${g.toLocaleString('en-US')}</span>`);
  if (s) out.push(`<span class="coin s">${s}</span>`);
  if (c || !out.length) out.push(`<span class="coin c">${c}</span>`);
  return `<span class="money${neg ? ' neg' : ''}">${neg ? '<span class="sign">−</span>' : ''}${out.join('')}</span>`;
}
