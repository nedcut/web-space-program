/**
 * Which parts do the stock craft showcase? Prints every catalogue part with the stock craft that use it,
 * unused parts first. `npx tsx scripts/stock-coverage.ts [--unused]`
 */
import { PART_CATALOG } from '../src/data/parts';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';

const users = new Map<string, Set<string>>();
for (const s of STOCK_CRAFTS) for (const p of s.build().parts) {
  if (!users.has(p.partId)) users.set(p.partId, new Set());
  users.get(p.partId)!.add(s.id.replace(/^stock-/, ''));
}
const rows = [...PART_CATALOG.values()].map(d => ({ id: d.id, category: d.category, name: d.name, used: [...users.get(d.id) ?? []] }))
  .sort((a, b) => a.used.length - b.used.length || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
const unusedOnly = process.argv.includes('--unused');
for (const r of rows) if (!unusedOnly || !r.used.length) console.log(`${String(r.used.length).padStart(2)}  ${r.category.padEnd(12)} ${r.id.padEnd(24)} ${r.name.padEnd(28)} ${r.used.join(', ')}`);
const unused = rows.filter(r => !r.used.length).length;
console.log(`\n${rows.length} parts, ${rows.length - unused} used by ${STOCK_CRAFTS.length} stock craft, ${unused} never showcased.`);
