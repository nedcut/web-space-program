import type { World } from '../game/world';
import { formatDistance } from '../util/format';

export interface SituationBannerText { name: string; sub: string }

/** One-line "where am I" summary for the arrival banner (vessel name + situation). */
export function situationBanner(world: World): SituationBannerText | null {
  const wv = world.active;
  if (!wv) return null;
  const st = wv.state;
  const body = world.universe.body(wv.body);
  const name = st.name;
  if (st.eva) return { name, sub: st.situation === 'flying' ? `EVA near ${body.name}` : `EVA on ${body.name}` };
  if (wv.mode === 'prelaunch') return { name, sub: wv.body === 'earth' ? 'On the pad · Coastal Launch Complex' : `On the pad · ${body.name}` };
  if (st.situation === 'landed') return { name, sub: `Landed on ${body.name}` };
  if (st.situation === 'splashed') return { name, sub: `Splashed down on ${body.name}` };
  try {
    const o = world.orbitSummary(wv);
    const atmo = body.atmosphere?.height ?? 0;
    if (o.orbit.e >= 1) return { name, sub: `Escaping ${body.name}` };
    if (o.pe > atmo) return { name, sub: `Orbiting ${body.name} · ${formatDistance(o.ap)} × ${formatDistance(o.pe)}` };
    const alt = world.universe.surfaceInfo(wv.body, st.position, world.ut).altitude;
    return { name, sub: `${alt < atmo ? 'Flying' : 'Sub-orbital'} over ${body.name} · ${formatDistance(alt)}` };
  } catch {
    return { name, sub: body.name };
  }
}
