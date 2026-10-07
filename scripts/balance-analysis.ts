/** Reproduce numeric balance tables: npx tsx scripts/balance-analysis.ts.
 * Delta-v uses the runtime fuel/staging model, not a sum of isolated engine Isp estimates.
 * The campaign is a scripted successful-mission ledger; flights are verified separately in Vitest.
 */
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { PART_CATALOG } from '../src/data/parts';
import { TECH_NODES, launchCost } from '../src/data/technology';
import { computeStageStats } from '../src/editor/ui/dv';
import { preflightChecks } from '../src/editor/checks';
import { Universe } from '../src/game/universe';
import { standardCampaign } from './balanceCampaign';

const table = (head: string[], rows: (string | number)[][]) => {
  console.log(`| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |`);
  for (const row of rows) console.log(`| ${row.join(' | ')} |`);
};
console.log('Stock hardware and advisories (vacuum Δv is not a destination guarantee)');
table(['Craft', 'Scale', 'Cost cr', 'Δv m/s', 'Earth launch TWR', 'Required research', 'Advisories'], STOCK_CRAFTS.map(stock => {
  const c = stock.build();
  const stats = computeStageStats(c, PART_CATALOG, new Universe(stock.scale).body('earth'));
  const first = stats.get(0);
  const nodes = TECH_NODES.filter(n => n.id !== 'foundation' && c.parts.some(p => n.parts.includes(p.partId)));
  return [stock.name, stock.scale, launchCost(c, PART_CATALOG), Math.round([...stats.values()].reduce((sum, s) => sum + s.dvVac, 0)), first?.twrAsl.toFixed(2) ?? '—', nodes.map(n => n.id).join(', ') || 'foundation', preflightChecks(c, PART_CATALOG, first).map(c => c.id).join(', ') || 'none'];
}));
console.log('\nUnlock envelopes: highest Δv Earth rocket fixture whose every part is available. These are lower bounds on achievable Δv; unlimited staging has no unique maximum.');
table(['Cumulative branch tier', 'Science for propulsion branch', 'Standard fixture Δv', 'Challenging fixture Δv', 'Real fixture Δv'], [-1, 0, 1, 2, 3].map(tier => {
  const ids = TECH_NODES.filter(n => n.id === 'foundation' || Number(n.id.split('-').at(-1)) <= tier).flatMap(n => n.parts);
  const best = (scale: string) => {
    const candidates = STOCK_CRAFTS.filter(s => (s.scale === scale || s.id === 'stock-firstlight' || s.id === 'stock-meridian') && s.build().type === 'VAB' && (!s.launchBody || s.launchBody === 'earth') && s.build().parts.every(p => ids.includes(p.partId)));
    return Math.round(Math.max(0, ...candidates.map(s => [...computeStageStats(s.build(), PART_CATALOG).values()].reduce((sum, r) => sum + r.dvVac, 0))));
  };
  return [tier < 0 ? 'foundation' : `${tier} (all branches)`, [0,10,45,135,315][tier + 1], best('standard'), best('challenging'), best('real')];
}));
console.log('\nScale requirements (circular speed; launch allowances are planning assumptions)');
table(['Scale', 'Low orbit altitude km', 'Circular speed m/s', 'Launch budget m/s', 'Moon departure from low orbit m/s'], ['standard','challenging','real'].map(preset => {
  const u = new Universe(preset as 'standard'|'challenging'|'real'), earth = u.body('earth'), moon = u.body('moon');
  const h = earth.atmosphere!.height + 20000, r = earth.radius + h, v = Math.sqrt(earth.gm/r);
  const departure = Math.sqrt(earth.gm/r) * (Math.sqrt(2 * moon.orbit!.a / (r + moon.orbit!.a)) - 1);
  return [preset, Math.round(h/1000), Math.round(v), Math.round(v + (preset === 'standard' ? 1400 : 1800)), Math.round(departure)];
}));
console.log('\nScripted Standard campaign: full vehicle cost lost each flight, full recovered science, no salvage credited. Surface/flight contexts are chosen deliberately; this is not a novice success-rate model.');
const { rows } = standardCampaign();
table(['Mission','Objective','Cost cr','Science earned','Science bank','Funds after','Research purchased'],rows);
