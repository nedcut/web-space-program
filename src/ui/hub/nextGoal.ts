import { TECH_NODES, facilityProblem, partUnlocked, type FacilityBlock } from '../../data/technology';
import { PART_CATALOG } from '../../data/parts';
import { careerScaleMultiplier } from '../../sim/bodies/scale';
import { contractSlots, costToLevel } from '../../sim/science/facilities';
import { STOCK_CRAFTS } from '../../editor/stockCrafts';
import type { ScalePresetId } from '../../sim/bodies/scale';
import type { GameMode, Progression } from '../../sim/science/progression';
import type { HubFacilityId } from './facilities';

/**
 * The program's next step for the hub: one goal, the stock vehicle that can do it, and what stands in the way
 * (research to buy, science still to earn). DOM-free; computed on hub render only.
 */
export interface NextGoal {
  /** Milestone being worked toward. */
  title: string;
  /** One or two sentences: how. */
  detail: string;
  /** Facility the primary button opens. */
  action: HubFacilityId;
  actionLabel: string;
  /** Stock vehicle to highlight when this goal opens the launch picker. */
  recommendedStockId?: string;
  /** Secondary note (e.g. offers waiting in Mission Control). */
  aside: string | null;
  /** A facility upgrade is the blocker: the primary button offers it instead of `action`. */
  upgrade?: FacilityBlock;
}

interface Step {
  milestone: string | null; title: string; craft: Partial<Record<ScalePresetId, string>>; how: string; howOn?: Partial<Record<ScalePresetId, string>>;
  /** Planet whose launch season the step waits for (the hub shows how far off it is). */
  season?: Planet;
  /** Only on these scales (a stock design exists only there). */
  only?: ScalePresetId[];
}
export type Planet = 'venus' | 'mars';
/** Days until each planet's next launch season (hub: `nextLaunchSeason` from the program's date). */
export type Seasons = Partial<Record<Planet, number>>;
const PETREL = { standard: 'stock-petrel', challenging: 'stock-petrel-challenging', real: 'stock-petrel-real' };
const probeHow = (planet: string) => `Launch a few days before the ${planet} season and wait in orbit. During a ground station pass, open the map's Maneuver planner, pick ${planet} and a departure, then Flight assist → Execute next node. Plan a small correction on the way and capture with the probe's kick stage.`;

const STEPS: Step[] = [
  { milestone: 'first-orbit', title: 'Reach orbit', craft: { standard: 'stock-firstlight', challenging: 'stock-meridian-challenging', real: 'stock-meridian-real' },
    how: 'Tip east at about 50 m/s, cut the engines once apoapsis is above the atmosphere, then burn prograde at apoapsis (Maneuver planner · Circularize).' },
  { milestone: 'first-moon-flyby', title: 'Fly to the Moon', craft: { standard: 'stock-meridian', challenging: 'stock-meridian-challenging', real: 'stock-tern-real' },
    how: 'From a parking orbit, open the map\'s Maneuver planner and plan a transfer to the Moon. Use “Free return” to come home without stopping.',
    howOn: { real: 'A probe flies only the nodes it received while a ground station could hear it: plan the transfer during a pass (signal bars lit), then Flight assist → Execute next node. Capture into a low lunar orbit and run the instruments over each region; transmit as you go.' } },
  { milestone: 'first-moon', title: 'Land on the Moon', craft: { standard: 'stock-selene', challenging: 'stock-selene-challenging', real: 'stock-selene-real' },
    how: 'Capture into a low lunar orbit, drop the transfer stage and descend; the Flight assist app can fly the landing. Bring the capsule home.' },
  { milestone: 'first-mars', title: 'Send a probe to Mars', craft: PETREL, season: 'mars', how: probeHow('Mars') },
  { milestone: 'first-venus', title: 'Send a probe to Venus', craft: PETREL, season: 'venus', how: probeHow('Venus') },
  { milestone: 'first-venus-landing', title: 'Land on Venus', craft: { standard: 'stock-cinderbloom' }, season: 'venus', only: ['standard'],
    how: 'Use the planner\'s Entry trim to bring the arrival into the air, drop the cruise stage at the top of the atmosphere, hold retrograde and release the shield below 300 m/s. The Kiln shell reports from the surface.' },
];

/** Research nodes (with prerequisites) still needed to fly `stockId`, and their science cost. */
export function researchFor(stockId: string, p: Pick<Progression, 'unlocked'>, mode: GameMode): { nodes: string[]; cost: number } {
  const stock = STOCK_CRAFTS.find(s => s.id === stockId);
  if (!stock || mode === 'sandbox') return { nodes: [], cost: 0 };
  const progress = { ...emptyProgress, unlocked: p.unlocked };
  const need = new Set<string>();
  const add = (id: string) => {
    if (p.unlocked.includes(id) || need.has(id)) return;
    need.add(id);
    for (const r of TECH_NODES.find(n => n.id === id)?.requires ?? []) add(r);
  };
  for (const part of stock.build().parts) {
    if (partUnlocked(part.partId, mode, progress)) continue;
    const node = TECH_NODES.find(n => n.parts.includes(part.partId));
    if (node) add(node.id);
  }
  const nodes = TECH_NODES.filter(n => need.has(n.id)).map(n => n.id);
  return { nodes, cost: nodes.reduce((sum, id) => sum + (TECH_NODES.find(n => n.id === id)?.cost ?? 0), 0) };
}
const emptyProgress: Progression = { science: 0, funds: 0, reputation: 0, unlocked: [], archive: {}, nextDataId: 1, contracts: [], contractSeed: 0, contractBatch: 0, milestones: [] };

const FACILITY_NAME = { pad: 'Launch Pad', hall: 'Integration Hall' } as const;
const nodeName = (id: string) => TECH_NODES.find(n => n.id === id)?.name ?? id;
const craftName = (id: string) => STOCK_CRAFTS.find(s => s.id === id)?.name ?? id;
const list = (names: string[]) => names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Launch season hint: when the planet's season is more than a few days away, how far, and how to wait for it. */
function seasonNote(planet: Planet, seasons: Seasons): string {
  const days = seasons[planet];
  if (days === undefined) return '';
  const name = planet === 'mars' ? 'Mars' : 'Venus';
  return days < 3 ? ` The ${name} launch season is now.` : ` Next ${name} launch season in about ${Math.round(days)} days: time warp in Fleet Tracking.`;
}

export function nextGoal(p: Progression, mode: GameMode, scale: ScalePresetId, seasons: Seasons = {}): NextGoal | null {
  if (mode === 'sandbox') return null;
  const offered = p.contracts.filter(c => c.status === 'offered').length;
  const active = p.contracts.filter(c => c.status === 'active').length;
  const aside = mode === 'career' && offered > 0 && active < contractSlots(p, mode) ? `${offered} commission${offered > 1 ? 's' : ''} waiting in Mission Control` : null;
  if (mode === 'career' && active === 0 && offered > 0 && !p.milestones.length && !Object.keys(p.archive).length)
    return { title: 'Take your first commissions', detail: 'Accept the offers you can fly: their advances pay for the first rockets, and a field survey at the launch complex can be done on the pad.', action: 'missions', actionLabel: 'Mission Control', aside: null };
  if (!Object.keys(p.archive).length && !p.milestones.length)
    return { title: 'Fly a sounding rocket', detail: 'Launch the stock Kestrel. When the Science app lights up, open it and run the crew report (and any instruments you fitted): on the pad, in the air and in space. Stage the parachute on the way down, then recover the capsule.', action: 'launch', actionLabel: 'Launch Pad', aside, recommendedStockId: scale === 'standard' ? 'stock-kestrel' : `stock-kestrel-${scale}` };
  const open = STEPS.filter(s => (!s.milestone || !p.milestones.includes(s.milestone)) && (!s.only || s.only.includes(scale)));
  // Two probe goals open at once: the one whose launch season comes first.
  const step = open[0]?.season && open[1]?.season && (seasons[open[1].season] ?? Infinity) < (seasons[open[0].season] ?? Infinity) ? open[1] : open[0];
  if (!step) return { title: 'Explore the outer planets', detail: 'Venus and Mars are charted. Farther out, watch the signal bars: the Horizon reflector (Deep Space Power) reaches the outer planets on every scale, and the Ringrunner flies to Saturn (first arrival: +150 science).', action: 'research', actionLabel: 'Research Lab', aside };
  const stockId = step.craft[scale];
  const research = stockId ? researchFor(stockId, p, mode) : { nodes: [], cost: 0 };
  if (research.nodes.length) {
    const names = list(research.nodes.map(nodeName));
    if (p.science >= research.cost)
      return { title: step.title, detail: `Research ${names} (${research.cost} science) to fly the ${craftName(stockId!)}.`, action: 'research', actionLabel: 'Research Lab', aside };
    const short = Math.ceil(research.cost - p.science);
    return { title: step.title, detail: `The ${craftName(stockId!)} needs ${names}: ${short} more science. New situations and biomes pay best: hop to space, splash down, fly over new terrain.`, action: 'launch', actionLabel: 'Launch Pad', aside };
  }
  const stock = stockId ? STOCK_CRAFTS.find(s => s.id === stockId) : undefined;
  const block = stock ? facilityProblem(stock.build(), PART_CATALOG, mode, p, scale) : null;
  if (block) {
    const cost = costToLevel(p, block.facility, block.level, careerScaleMultiplier(scale));
    const funds = p.funds >= cost ? `${cost.toLocaleString()} cr` : `${cost.toLocaleString()} cr, ${(cost - p.funds).toLocaleString()} cr more than you have`;
    return { title: step.title, detail: `The ${craftName(stockId!)} is ${block.reason}. Upgrade the ${FACILITY_NAME[block.facility]} to level ${block.level} (${funds}).`,
      action: block.facility === 'pad' ? 'launch' : 'editor', actionLabel: 'Upgrade', aside, upgrade: block };
  }
  return { title: step.title, detail: `${stockId ? `The ${craftName(stockId)} is ready. ` : ''}${step.howOn?.[scale] ?? step.how}${step.season ? seasonNote(step.season, seasons) : ''}`, action: 'launch', actionLabel: 'Launch Pad', aside, recommendedStockId: stockId };
}
