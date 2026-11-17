// One-command data update: pull the latest client-extraction snapshot, rebuild the
// compact recipe files, and refresh vendor sell prices.
//
// Usage:  node scripts/update-data.mjs   (or: npm run update)
//
// NOTE: the recipe *structure* (reagents, cast times, skill thresholds) comes from the
// MAF2414/wow-forever-talents client extraction. This script re-downloads their latest
// published snapshot — so it updates when they publish a newer build. Sell prices are
// re-fetched from Wowhead's live Forever data (dataEnv=16), which tracks new builds.

import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_URL = 'https://raw.githubusercontent.com/MAF2414/wow-forever-talents/main/docs/professions-data.json';

function run(cmd, args) {
  const r = spawnSync(process.execPath, [cmd, ...args], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error('\n`' + cmd + '` failed.'); process.exit(r.status || 1); }
}

console.log('Downloading recipe source (client extraction)…');
const res = await fetch(SRC_URL);
if (!res.ok) { console.error('Download failed:', res.status, res.statusText); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
const dest = join(root, 'data-src', 'professions-data.json');
writeFileSync(dest, buf);
console.log('Wrote data-src/professions-data.json (' + (buf.length / 1e6).toFixed(1) + ' MB)');

console.log('\nRebuilding compact data files…');
run('scripts/build-data.mjs', []);

console.log('\nRefreshing vendor sell prices (resumes, may take several minutes)…');
run('scripts/fetch-sell-prices.mjs', []);

console.log('\nData update complete.');
