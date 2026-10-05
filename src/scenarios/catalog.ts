import { STOCK_CRAFTS } from '../editor/stockCrafts';
import { PART_CATALOG } from '../data/parts';
import { World } from '../game/world';
import { Universe } from '../game/universe';
import { DEFAULT_START_UT } from '../game/store';
import { placeInCircularOrbit, spawnRendezvousTarget } from '../game/scenarios';
import { latLonToUnit } from '../sim/terrain';
import { qFromTo, qRotate } from '../util/quat';
import { add, cross, dot, length, normalize, scale, sub, v3, type Vec3 } from '../util/vec3';
import { propagate, solveLambert, stateToElements } from '../sim/orbit';
import type { CraftDef } from '../sim/vessel/types';

export type MissionId = 'ring-skimmer' | 'titan-descent' | 'plume-dive' | 'grand-tour' | 'moon-landing' | 'mars-aerobrake' | 'rendezvous' | 'suicide-burn' | 'moon-return' | 'jupiter-assist';
export interface Budget { time: number; dv: number; speed: number; precision: number }
export interface Scenario {
  id: MissionId; title: string; region: string; craft: string; briefing: string; objective: string; hint: string; source: string;
  gold: Budget; silver: Budget;
}
const budget = (time: number, dv: number, speed = Infinity, precision = Infinity): Budget => ({ time, dv, speed, precision });
const saturnSource = 'https://science.nasa.gov/saturn/facts/';
const moonSource = 'https://science.nasa.gov/moon/facts/';
export const SCENARIOS: Scenario[] = [
  { id: 'ring-skimmer', title: 'Ring Skimmer', region: 'Saturn · Cassini Division', craft: 'gossamer', briefing: 'Saturn’s rings are countless orbiting fragments, mostly water ice. The Cassini Division separates the bright A and B rings but is not empty. Thread its dark corridor with Gossamer and watch the sunlit ice sweep past.', objective: 'Cross the ring plane inside the Cassini Division, then clear it by 5 km with every original part intact. Aim for the gap center at 11,987.5 km from Saturn’s center.', hint: 'Start 12 km north of the rings, falling south at 180 m/s. Ring chunks are visual only; precision and thrust usage decide your medal.', source: saturnSource, gold: budget(150, 15, Infinity, 2000), silver: budget(300, 80, Infinity, 80000) },
  { id: 'titan-descent', title: 'Titan Descent', region: 'Saturn · Titan', craft: 'hazewalker', briefing: 'Titan’s dense nitrogen atmosphere hides a landscape where methane cycles between clouds, rain and lakes. Hazewalker arrives shield first. Let the haze take your speed away before opening the parachutes.', objective: 'Enter Titan’s atmosphere, deploy a full parachute and land within 5 km of Haze Sound at less than 5 m/s.', hint: '60 km altitude; 1.2 km/s downward. Hold surface retrograde. Below 12 km, stage twice to activate propulsion at zero throttle and arm chutes. Target coordinates appear in flight.', source: 'https://science.nasa.gov/saturn/moons/titan/facts/', gold: budget(450, 10, 3, 500), silver: budget(900, 100, 4, 2000) },
  { id: 'plume-dive', title: 'Enceladus Plume Dive', region: 'Saturn · Enceladus', craft: 'frostwhisker', briefing: 'Water vapor and ice escape through fractures near Enceladus’s south pole, carrying traces of its buried ocean into space. Make a low sampling pass through that polar curtain, then climb clear of the ice.', objective: 'Pass south of 80°S below 10 km terrain clearance, then leave above 15 km intact. Sampling below 5 km earns a science bonus.', hint: 'A polar flyby begins 18 km above the ice. Coast through the south pole; use a small trim if needed. The bonus is mission score, separate from career science.', source: 'https://science.nasa.gov/missions/cassini/the-moon-with-the-plume/', gold: budget(600, 15), silver: budget(1200, 100) },
  { id: 'grand-tour', title: 'Grand Tour of Saturn’s Moons', region: 'Saturn · Five moons', craft: 'longreach', briefing: 'From Titan’s atmosphere to Enceladus’s active ice, Saturn offers a miniature planetary system. Rhea, Dione and Tethys add cratered worlds to your itinerary. Longreach’s nuclear engine rewards patient planning.', objective: 'Enter the SOIs of Titan, Rhea, Dione, Tethys and Enceladus in one continuous trip. Visit order is yours.', hint: 'Begin in a 30 km Titan orbit. Use maneuver plans and warp; preserve propellant for each encounter. Thrust usage dominates scoring.', source: 'https://science.nasa.gov/saturn/moons/', gold: budget(Infinity, 6000), silver: budget(Infinity, 10000) },
  { id: 'moon-landing', title: 'Moon Landing Challenge', region: 'Moon · Copernicus approach', craft: 'selene', briefing: 'Without an atmosphere, the Moon gives you no aerodynamic brake. Copernicus is a prominent impact crater on the lunar near side. Bring Selene down at a fixed survey point in its vicinity; our terrain is procedural rather than a surveyed crater map.', objective: 'Land within 2 km of Copernicus Survey (9.62°N, 20.08°W) below 5 m/s.', hint: 'Start in a 20 km lunar orbit above the target. Retrograde thrust lowers your orbit; extend the legs. Surface coordinates and miss distance update in flight.', source: moonSource, gold: budget(1200, 900, 2, 100), silver: budget(2400, 1500, 3.5, 500) },
  { id: 'mars-aerobrake', title: 'Mars Aerobrake', region: 'Mars · Atmospheric capture', craft: 'emberleaf', briefing: 'Mars’s thin carbon dioxide atmosphere can remove orbital energy through drag. This challenge is an aerocapture: one atmospheric encounter converts an unbound arrival into a safe orbit. Real aerobraking usually lowers an already bound orbit over repeated passes.', objective: 'Enter the atmosphere, then exit into a bound Mars orbit with periapsis above terrain. Use no propulsion, including RCS.', hint: 'Arrival starts above the atmosphere on a grazing hyperbola. Hold surface retrograde to present the shield. Pitch changes drag; do not deploy a chute unless you want to descend.', source: 'https://science.nasa.gov/learn/basics-of-space-flight/chapter16-2/', gold: budget(2400, 0.01), silver: budget(4800, 0.01) },
  { id: 'rendezvous', title: 'Rendezvous Race', region: 'Earth · Hearthlight station', craft: 'tender', briefing: 'Orbital rendezvous is a meeting of positions and velocities. A faster orbit does not always mean catching up sooner: lower orbits complete their laps more quickly. Match Hearthlight’s motion and bring the docking collars together.', objective: 'Dock Wren with the Hearthlight station. Fastest docking wins; fuel economy breaks close races.', hint: 'Station starts 100 m ahead in a 150 km Earth orbit. Select target, enable RCS and docking mode; approach below 0.5 m/s.', source: 'https://science.nasa.gov/learn/basics-of-space-flight/chapter4-1/', gold: budget(120, 20), silver: budget(300, 60) },
  { id: 'suicide-burn', title: 'Suicide Burn', region: 'Moon · Terminal descent', craft: 'selene', briefing: 'Stopping distance grows with the square of speed. Lunar gravity keeps accelerating a falling lander until engine thrust exceeds its weight. Delay the burn for efficiency, but leave room for a safe touchdown.', objective: 'Land from 5 km terrain clearance below 5 m/s without hovering for more than two seconds.', hint: 'Falling at 100 m/s, engine ready and legs extended. Near-zero vertical speed above 100 m counts as hovering. Braking distance is approximately speed² / (2 × net deceleration).', source: moonSource, gold: budget(120, 210, 2), silver: budget(240, 350, 3.5) },
  { id: 'moon-return', title: 'Return From the Moon', region: 'Earth · Lunar return corridor', craft: 'homeward', briefing: 'A lunar return approaches Earth faster than a low-orbit descent. An ablative shield converts that kinetic energy into heat carried away by the air and eroding shield material. Your return corridor is already set; spend the small fuel reserve carefully.', objective: 'Survive Earth atmospheric entry and land below 8 m/s after deploying a full chute.', hint: 'Begin at 120 km above Earth with a lunar-return-speed entry and only 10% tank fuel. Stage twice before entry to discard the service module and arm the chutes. Keep the shield into the airflow; parachutes open when pressure and speed permit.', source: 'https://science.nasa.gov/learn/basics-of-space-flight/chapter16-2/', gold: budget(1800, 40, 5), silver: budget(3600, 120, 7) },
  { id: 'jupiter-assist', title: 'Jupiter Gravity Assist', region: 'Jupiter → Saturn', craft: 'longreach', briefing: 'A gravity assist exchanges orbital momentum with a moving planet. Relative to Jupiter, a coasting probe leaves with the same excess speed it arrived with, but a new direction. Relative to the Sun, that turn can send you outward toward Saturn.', objective: 'Pass Jupiter periapsis, leave its SOI and enter Saturn’s SOI with minimal thrust usage.', hint: 'An inbound hyperbola is seeded from a Saturn-bound Lambert corridor. The epoch is chosen for an outward transfer. Use map predictions and small cruise corrections; arrival means an SOI encounter, not capture.', source: 'https://science.nasa.gov/mission/cassini/gravity-assists/', gold: budget(Infinity, 250), silver: budget(Infinity, 1000) },
];

export interface Setup { id: MissionId; world: World; craft: CraftDef; target?: Vec3; targetName?: string; stationId?: string; vesselId?: string }
export function stock(id: string): CraftDef {
  const entry = STOCK_CRAFTS.find(c => c.id === `stock-${id}`);
  if (!entry) throw new Error(`Missing stock craft: ${id}`);
  const craft = entry.build();
  const cutoff = id === 'selene' || id === 'hearthlight' ? 'eng-doldrum' : id === 'gossamer' || id === 'homeward' ? 'eng-zephyr' : null;
  if (!cutoff) return craft;
  const engine = craft.parts.find(p => p.partId === cutoff)!;
  const removed = new Set<number>();
  for (const p of craft.parts) if (p.parent === engine.uid || (p.parent != null && removed.has(p.parent))) removed.add(p.uid);
  return { ...craft, parts: craft.parts.filter(p => !removed.has(p.uid)).map(p => ({ ...p, stage: p.partId.includes('chute') || p.partId.startsWith('dec-') ? 0 : 1 })) };
}
/** Public placement helper: body-relative inertial COM vectors, with the nose along the supplied direction. */
export function spawnRelative(world: World, craft: CraftDef, body: string, position: Vec3, velocity: Vec3, nose = normalize(velocity)) {
  const bs = world.universe.ephem.getBodyState(body, world.ut);
  const vessel = world.spawnVessel(craft, { position: add(bs.position, position), velocity: add(bs.velocity, velocity), orientation: qFromTo(v3(0, 1, 0), nose) });
  vessel.body = body;
  world.switchTo(vessel.state.id);
  return vessel;
}
/** Choose an epoch with the requested fixed target in daylight, preserving repeatable geometry. */
function daylight(world: World, body: string, target: Vec3) {
  const period = world.universe.body(body).rotationPeriod;
  let best = -Infinity, epoch = world.ut;
  for (let i = 0; i < 64; i++) {
    const t = DEFAULT_START_UT + period * i / 64;
    const bs = world.universe.ephem.getBodyState(body, t);
    const light = dot(qRotate(world.universe.ephem.bodyRotation(body, t), target), normalize(scale(bs.position, -1)));
    if (light > best) { best = light; epoch = t; }
  }
  world.ut = epoch;
}
export function setupScenario(scenario: Scenario): Setup {
  const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  world.commsSettings.enabled = false;
  const craft = stock(scenario.craft);
  const setup: Setup = { id: scenario.id, world, craft };
  if (scenario.id === 'jupiter-assist') { setupJupiter(world, craft); setup.vesselId = world.active!.state.id; return setup; }
  const body = scenario.id === 'ring-skimmer' ? 'saturn' : scenario.id === 'plume-dive' ? 'enceladus' : scenario.id === 'titan-descent' || scenario.id === 'grand-tour' ? 'titan' : scenario.id === 'moon-landing' || scenario.id === 'suicide-burn' ? 'moon' : scenario.id === 'mars-aerobrake' ? 'mars' : 'earth';
  const b = world.universe.body(body);
  let target = v3(1, 0, 0);
  if (scenario.id === 'moon-landing') { target = latLonToUnit(9.62, -20.08); setup.targetName = 'Copernicus Survey · 9.62°N, 20.08°W'; }
  if (scenario.id === 'titan-descent') { target = normalize(v3(0.7, 0.2, 0.68)); setup.targetName = `Haze Sound · ${(Math.asin(target.z) * 180 / Math.PI).toFixed(2)}°N, ${(Math.atan2(target.y, target.x) * 180 / Math.PI).toFixed(2)}°E`; }
  daylight(world, body, target);
  const rotation = world.universe.ephem.bodyRotation(body, world.ut);
  const up = qRotate(rotation, target);
  const east = normalize(cross(qRotate(rotation, v3(0, 0, 1)), up));
  const ground = b.solidSurface ? world.universe.terrain(body).heightAt(target.x, target.y, target.z) : 0;
  if (scenario.id === 'ring-skimmer') {
    const radius = 11987500;
    const towardSun = world.universe.ephem.toBodyFixed(body, normalize(scale(world.universe.ephem.getBodyState(body, world.ut).position, -1)), world.ut);
    const angle = Math.atan2(towardSun.y, towardSun.x);
    const radial = v3(Math.cos(angle), Math.sin(angle), 0), tangent = v3(-radial.y, radial.x, 0);
    spawnRelative(world, craft, body, qRotate(rotation, add(scale(radial, radius), v3(0, 0, 12000))), qRotate(rotation, add(scale(tangent, Math.sqrt(b.gm / radius)), v3(0, 0, -180))));
  } else if (scenario.id === 'plume-dive') {
    const r = b.radius + 4000, x = -Math.sqrt((b.radius + 18000) ** 2 - r ** 2);
    spawnRelative(world, craft, body, qRotate(rotation, v3(x, 0, -r)), qRotate(rotation, v3(360, 0, 0)));
  } else if (scenario.id === 'titan-descent' || scenario.id === 'suicide-burn') {
    const alt = scenario.id === 'titan-descent' ? 60000 : ground + 5000;
    const rel = scale(up, b.radius + alt);
    spawnRelative(world, craft, body, rel, add(world.universe.ephem.surfaceVelocity(body, rel, world.ut), scale(up, scenario.id === 'titan-descent' ? -1200 : -100)), up);
    setup.target = target;
    if (scenario.id === 'suicide-burn') for (const p of world.active!.state.parts) { if (p.engine) p.engine.ignited = true; if (p.leg) p.leg.deployed = true; }
  } else if (scenario.id === 'mars-aerobrake') {
    // Inbound unbound conic: datum periapsis 15 km, small positive excess energy.
    const rp = b.radius + 15000, r = b.radius + b.atmosphere!.height + 15000, excess = 80;
    const h = rp * Math.sqrt(2 * b.gm / rp + excess ** 2);
    const tangential = h / r, radial = -Math.sqrt(2 * b.gm / r + excess ** 2 - tangential ** 2);
    const velocity = add(scale(east, tangential), scale(up, radial));
    spawnRelative(world, craft, body, scale(up, r), velocity, scale(normalize(velocity), -1));
  } else if (scenario.id === 'moon-return') {
    for (const p of craft.parts) {
      const resources = { ...PART_CATALOG.get(p.partId)?.resources, ...p.resources };
      for (const key of ['liquidFuel', 'oxidizer', 'monopropellant'] as const) if (resources[key]) resources[key] *= 0.1;
      p.resources = resources;
    }
    const rel = scale(up, b.radius + 120000);
    const velocity = add(scale(east, 3350), scale(up, -650));
    spawnRelative(world, craft, body, rel, velocity, scale(normalize(velocity), -1));
  } else {
    const alt = body === 'earth' ? 150000 : body === 'titan' ? 30000 : 20000;
    const vessel = spawnRelative(world, craft, body, scale(up, b.radius + alt), scale(east, Math.sqrt(b.gm / (b.radius + alt))));
    placeInCircularOrbit(world, vessel, body, alt);
    if (scenario.id === 'moon-landing') setup.target = target;
    if (scenario.id === 'rendezvous') setup.stationId = spawnRendezvousTarget(world, stock('hearthlight'), 100)?.state.id;
  }
  setup.vesselId = world.active!.state.id;
  return setup;
}

function setupJupiter(world: World, craft: CraftDef) {
  const u = world.universe, j = u.body('jupiter'), rp = j.radius * 2.5;
  // Solve a solar transfer, then invert a Jovian hyperbola whose outgoing asymptote matches it.
  for (let year = 0; year < 12; year++) {
    const encounter = DEFAULT_START_UT + year * 365.25 * 86400 * Math.sqrt(0.1);
    const js = u.ephem.getBodyState('jupiter', encounter);
    const tof = 3 * 365.25 * 86400 * Math.sqrt(0.1);
    const ss = u.ephem.getBodyState('saturn', encounter + tof);
    const out = sub(solveLambert(u.body('sun').gm, js.position, ss.position, tof).departureVelocity, js.velocity);
    const vinf = length(out);
    if (vinf < 100) continue;
    const e = 1 + rp * vinf ** 2 / j.gm, nu = Math.acos(-1 / e);
    const direction = normalize(out), normal = normalize(cross(direction, v3(0, 0, 1)));
    // Velocity direction at infinity is (-sin(nu), e+cos(nu)) in the periapsis basis.
    const a = -Math.sin(nu), c = e + Math.cos(nu), norm = Math.hypot(a, c);
    const peri = add(scale(direction, a / norm), scale(normal, c / norm));
    const tangent = add(scale(direction, c / norm), scale(normal, -a / norm));
    const orbit = stateToElements(j.gm, 'jupiter', scale(peri, rp), scale(tangent, Math.sqrt(vinf ** 2 + 2 * j.gm / rp)), encounter);
    const lead = 4 * rp / vinf;
    world.ut = encounter - lead;
    const incoming = propagate(orbit, world.ut);
    spawnRelative(world, craft, 'jupiter', incoming.position, incoming.velocity);
    world.setTarget('saturn');
    return;
  }
  throw new Error('No Jupiter assist corridor found');
}
