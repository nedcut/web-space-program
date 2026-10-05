import { BODY_DEFS } from './bodies';
import { PART_DEFS } from './parts';
import { TECH_NODES } from './technology';
import { sampleAtmosphere } from '../sim/atmosphere';
import type { BodyDef } from '../sim/bodies/types';

const portraits: Record<string, string> = {
  saturn: 'Saturn is a hydrogen–helium giant with no solid landing surface. Rapid rotation flattens its globe, and winds stretch clouds into pale gold bands. Its rings are countless independently orbiting pieces of mostly water ice, rather than a solid disc. Moon resonances sculpt gaps and edges; the broad Cassini Division separates the bright A and B rings. Sunlight changes the rings’ appearance as their tilted plane moves through Saturn’s seasons.',
  titan: 'Titan carries a dense, mostly nitrogen atmosphere beneath an orange organic haze. Methane rains, carves channels and collects with ethane in lakes and seas. At these cold temperatures, water ice behaves like rock. The Huygens probe reached the surface in 2005, revealing a landscape shaped by flowing liquids.',
  enceladus: 'Fresh water ice makes Enceladus exceptionally reflective. Jets escape through fractures near its south pole, carrying water vapour, ice grains and organic compounds from an ocean beneath the crust. Escaping grains replenish Saturn’s diffuse E ring. Tidal flexing helps power this tiny moon’s activity.',
  pan: 'Pan orbits inside the Encke gap in Saturn’s A ring. Its gravity clears a lane through the particles and launches waves along the edges. Accreted ring material gives the little moon a conspicuous equatorial ridge.',
  daphnis: 'Daphnis travels in the narrow Keeler gap. Its gravity raises ripples along the ring edges, including waves that rise out of the ring plane. Even a tiny moon can leave a large signature in a thin disc of orbiting ice.',
  iapetus: 'Iapetus has a dark leading hemisphere and a much brighter trailing side. Dark material and the migration of surface ice reinforce the contrast. A remarkable ridge follows much of its equator; its origin remains debated.',
  hyperion: 'Hyperion is porous and irregular, with deep craters that give it a sponge-like appearance. Its rotation tumbles chaotically rather than keeping one face steadily toward Saturn. A simple fixed rotation in the game is an approximation.',
  janus: 'Janus shares nearly the same orbit as Epimetheus. When the pair approach, their gravitational interaction exchanges their inner and outer orbital roles instead of letting them collide. The game represents them with independent mean orbits.',
  epimetheus: 'Epimetheus and Janus are co-orbital companions. Their mutual gravity makes them trade orbital lanes about every four years. Epimetheus is smaller, so its lane changes more than Janus’s. This interaction is not reproduced by the game’s fixed Keplerian rails.',
};
export const BODY_ARTICLES = BODY_DEFS.map(body => ({ id: body.id, name: body.name, kind: 'body' as const, text: portraits[body.id] ?? body.description ?? `${body.name} is a ${body.kind} in our solar system.` }));
export const PART_ARTICLES = PART_DEFS.map(part => ({ id: part.id, name: part.name, kind: 'part' as const, text: part.description, research: TECH_NODES.find(n => n.parts.includes(part.id))! }));
export const FLIGHT_SCHOOL = [
  { id: 'apoapsis', name: 'Apoapsis & periapsis', text: 'Apoapsis is the farthest point of an orbit from its focus; periapsis is the closest. A prograde burn near periapsis raises apoapsis. Altitude subtracts the body’s datum radius from the distance to its centre.', diagram: 'orbit' },
  { id: 'dv', name: 'Δv · velocity budget', text: 'Delta-v measures a change in velocity, in metres per second. For an ideal rocket, Δv = Isp × g₀ × ln(initial mass / final mass). Gravity, drag and steering spend additional budget during a real flight.', diagram: 'burn' },
  { id: 'isp', name: 'Isp · specific impulse', text: 'Specific impulse is thrust divided by propellant mass flow and standard gravity. Its unit is seconds. Higher Isp gives more velocity change per unit of propellant; pressure and engine design affect it.', diagram: 'burn' },
  { id: 'twr', name: 'TWR · thrust-to-weight ratio', text: 'TWR = thrust / (mass × local gravity). Vertical liftoff needs TWR above one. In free fall, an engine can change an orbit even when TWR is much smaller than one.', diagram: 'burn' },
  { id: 'soi', name: 'SOI · sphere of influence', text: 'The sphere of influence is the region where a patched-conic model uses one body as the gravitational focus. Crossing it changes the reference body. Real gravity changes smoothly; there is no physical wall at this boundary.', diagram: 'orbit' },
  { id: 'hohmann', name: 'Hohmann transfer', text: 'Two tangential burns connect coplanar circular orbits through a transfer ellipse. The first reaches the other orbit; the second matches its circular speed. Meeting a moving target also requires the right departure phase.', diagram: 'transfer' },
  { id: 'gravity-turn', name: 'Gravity turn', text: 'After a small pitch away from vertical, gravity bends the ascent while the rocket largely follows its velocity. Build horizontal speed gradually and avoid sharp steering in dense air. Orbit is sustained sideways motion, not simply height.', diagram: 'turn' },
  { id: 'aerobraking', name: 'Aerobraking', text: 'Repeated shallow atmospheric passes remove orbital energy through drag and lower apoapsis. Heating, pressure and terrain constrain each pass. Aerocapture instead aims to enter a bound orbit in a single atmospheric passage.', diagram: 'orbit' },
  { id: 'oberth', name: 'Oberth effect', text: 'A given prograde velocity change adds more orbital energy when the craft is already moving quickly. For an impulsive burn, the specific energy change is v × Δv + Δv² / 2. This favours burns near periapsis.', diagram: 'burn' },
  { id: 'inclination', name: 'Inclination & orbital nodes', text: 'Inclination measures the tilt of an orbital plane relative to a reference plane. Ascending and descending nodes mark crossings. Plane changes cost less at low speed, often near apoapsis.', diagram: 'orbit' },
] as const;
export const PEDIA_INDEX = [...BODY_ARTICLES, ...PART_ARTICLES, ...FLIGHT_SCHOOL.map(a => ({ ...a, kind: 'lesson' as const }))];

/** Altitudes increase; pressure decreases. Temperature may invert between layers. */
export function atmosphereProfile(body: BodyDef, steps = 80) {
  if (!body.atmosphere) return [];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const altitude = body.atmosphere!.height * i / steps;
    return { altitude, ...sampleAtmosphere(body.atmosphere, altitude, body.gm / body.radius ** 2) };
  });
}
