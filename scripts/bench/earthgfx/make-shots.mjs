// Build a shots.json for earthgfx-shots.mjs: node make-shots.mjs <baseUrl> <prefix> <quality[:earthTier]>,... [views...] > shots.json
import { readFileSync } from 'node:fs';
const [base, prefix, tiers, ...only] = process.argv.slice(2);
const views = JSON.parse(readFileSync(new URL('./views.json', import.meta.url), 'utf8'));
const out = [];
for (const t of tiers.split(',')) {
  const [quality, earth] = t.split(':');
  for (const [name, q] of Object.entries(views)) {
    if (only.length && !only.includes(name)) continue;
    out.push({ name: `${prefix}-${name}-${earth ?? quality}`, url: `${base}/planet-preview.html?body=earth&ui=0&settle=1&quality=${quality}${earth ? `&earth=${earth}` : ''}&${q}`, dpr: 2, settle: 2500, timeout: 120000 });
  }
}
console.log(JSON.stringify(out, null, 1));
