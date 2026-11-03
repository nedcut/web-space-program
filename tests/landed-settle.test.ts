import { describe, expect, it } from 'vitest';
import { World, type WorldVessel } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { placeOnSurface } from '../src/game/scenarios';
import { landingController } from '../src/game/autopilot';
import { buildMoonLander, STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { buildVessel, neutralInput, SETTLE_AIRBORNE_S, SETTLE_CONTACT_S, setSituation, settleSituation, type Situation } from '../src/sim/vessel';
import { RESOURCES } from '../src/data/resources';
import { add, normalize, scale, sub } from '../src/util/vec3';

const DT = 0.02;

const cricket = () => STOCK_CRAFTS.find(c => c.id === 'stock-cricket')!.build();
/** The Cricket hopper on the Moon on its deployed legs, raised `height` m and moving down at `speed` m/s. */
function lunarDrop(speed: number, height: number) {
  const w = new World(new Universe('standard'), PART_CATALOG, 1000);
  const v = w.launch(cricket());
  placeOnSurface(w, v, 'moon');
  lift(w, v, height, speed);
  // Arriving from a flight (a hop shorter than SETTLE_AIRBORNE_S off a landed state is not one).
  if (height > 1) setSituation(v.state, 'flying');
  return { w, v };
}
function lift(w: World, v: WorldVessel, height: number, downSpeed: number) {
  const up = normalize(sub(v.state.position, w.universe.ephem.getBodyState(v.body, w.ut).position));
  v.state.position = add(v.state.position, scale(up, height));
  v.state.velocity = add(v.state.velocity, scale(up, -downSpeed));
}
/** Runs `steps` physics steps, returning how often the raw situation changed. */
function run(w: World, steps: number, each?: (i: number) => boolean | void) {
  let rawChanges = 0, last = w.active?.state.situation;
  for (let i = 0; i < steps; i++) {
    w.tick(DT, neutralInput());
    const s = w.active?.state.situation;
    if (s !== last) rawChanges++;
    last = s;
    if (each?.(i)) break;
  }
  return rawChanges;
}

describe('settled situation', () => {
  const state = () => buildVessel(buildMoonLander(), PART_CATALOG, { id: 't', resourceDefs: RESOURCES });
  const feed = (v: ReturnType<typeof state>, s: Situation, seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) { v.situation = s; settleSituation(v, DT); }
  };
  it('ignores one-step contact chatter in both directions', () => {
    const v = state();
    expect(v.settledSituation).toBe('flying');
    feed(v, 'landed', DT);
    expect(v.settledSituation).toBe('flying');
    feed(v, 'landed', SETTLE_CONTACT_S - 2 * DT);
    expect(v.settledSituation).toBe('flying');
    feed(v, 'landed', DT);
    expect(v.settledSituation).toBe('landed');
    // Resting legs blip off the ground for a step: still landed, and the contact clock is not lost.
    for (let i = 0; i < 20; i++) { feed(v, 'flying', DT); feed(v, 'landed', 10 * DT); }
    expect(v.settledSituation).toBe('landed');
    feed(v, 'flying', SETTLE_AIRBORNE_S - DT);
    expect(v.settledSituation).toBe('landed');
    feed(v, 'flying', DT);
    expect(v.settledSituation).toBe('flying');
  });
  it('counts contact across short hops, and follows landed -> splashed while grounded', () => {
    const v = state();
    // Five half-second touches separated by 2 s hops: grounded after the second.
    feed(v, 'landed', 0.5); feed(v, 'flying', 2); feed(v, 'landed', 0.5);
    expect(v.settledSituation).toBe('landed');
    feed(v, 'splashed', DT);
    expect(v.settledSituation).toBe('splashed');
  });
});

describe('touchdowns settle before they count as landed', () => {
  it('a bouncing, rocking lunar touchdown logs one landing at the first-contact speed', () => {
    const { w, v } = lunarDrop(4, 6);
    const rawChanges = run(w, 1000);
    // The raw contact really does chatter (it changes many times); the log shows one touchdown.
    expect(rawChanges).toBeGreaterThan(10);
    expect(v.state.settledSituation).toBe('landed');
    const r = w.flightlog.records.find(r => r.vesselId === v.state.id)!;
    const landings = r.events.filter(e => e.kind === 'landing' || e.kind === 'splashdown');
    expect(landings).toHaveLength(1);
    // First contact after a 6 m fall at 4 m/s down on the Moon is ~5.9 m/s; later bounces are ~1 m/s.
    expect(landings[0].speed).toBeGreaterThan(5);
    expect(r.events[0].kind).not.toBe('landing');
    expect(r.events.some(e => e.kind === 'launch')).toBe(true);
  });

  it('a resting lander packed on a contact-chatter step stays on the surface', () => {
    const { w, v } = lunarDrop(0, 0.05);
    let chatter = false;
    run(w, 3000, () => (chatter = v.state.situation === 'flying' && v.state.settledSituation === 'landed'));
    expect(chatter).toBe(true);
    // On the step the legs blipped off the ground, time advances unattended (the Tracking Station after leaving
    // the flight). Main packed it on a ground-crossing conic, and the rails impact deleted it as lost.
    w.activeId = null;
    w.advanceRailsTo(w.ut + 60);
    expect(w.vessels.get(v.state.id)?.mode).toBe('landedRails');
    expect(w.flightlog.records.find(r => r.vesselId === v.state.id)?.outcome).toBeUndefined();
  });

  it('a vessel only goes on a conic when both raw and settled say flying', () => {
    const { w, v } = lunarDrop(0, 0.05);
    v.state.settledSituation = 'flying'; v.state.airborneTime = SETTLE_AIRBORNE_S; v.state.contactTime = 0;
    v.state.situation = 'landed'; // raw: first contact of a touchdown, not settled yet
    (w as unknown as { pack(wv: WorldVessel): void }).pack(v);
    expect(v.mode).toBe('landedRails');
  });

  it('the landing autopilot flies the descent again after a bounce', () => {
    const { w, v } = lunarDrop(0, 0.05);
    w.tick(DT, neutralInput({ stage: true, throttle: 0 }));
    run(w, 200);
    expect(v.state.parts.some(p => p.engine?.ignited)).toBe(true);
    const ap = landingController(w);
    const fly = (steps: number, until?: () => boolean) => {
      for (let i = 0; i < steps; i++) {
        w.tick(DT, ap.update(w).input);
        if (until?.()) return true;
      }
      return false;
    };
    expect(fly(50, () => ap.status.startsWith('touchdown'))).toBe(true);
    // A bounce: 15 m up and rising (as off a rock). Main stayed in "touchdown" with the engine off, fell and
    // tipped over.
    lift(w, v, 15, -1);
    expect(fly(150, () => ap.status.startsWith('final descent'))).toBe(true);
    expect(fly(3000, () => ap.done || !!ap.error)).toBe(true);
    expect(ap.error).toBeUndefined();
    expect(ap.status).toMatch(/^landed/);
  });
});
