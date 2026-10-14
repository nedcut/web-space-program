/** Small visual readouts shared by the maneuver planner, departure options, node editor and transfer chart. */
import { dvText } from './plannerFormat';

const pct = (v: number, of: number) => `${Math.max(0, Math.min(100, (v / of) * 100)).toFixed(2)}%`;

/**
 * Δv budget: the vessel's remaining stages as coloured segments (firing order, vacuum) above the Δv a plan needs
 * (solid) plus an optional estimate still to come (hatched, e.g. capture). Turns red when the plan needs more than
 * the vessel has. `before` is Δv already spent by earlier nodes, drawn dim ahead of this plan.
 */
export function DvBudget({ stages, need, extra = 0, before = 0, extraLabel = 'capture' }: {
  stages: readonly { stage: number; dv: number }[]; need: number; extra?: number; before?: number; extraLabel?: string;
}) {
  const have = stages.reduce((s, x) => s + x.dv, 0);
  const total = before + need + extra;
  const scale = Math.max(have, total, 1);
  const short = total - have;
  const title = [
    `Needs ${dvText(need)}${extra ? ` + ${extraLabel} ~${dvText(extra)}` : ''}${before ? ` after ${dvText(before)} on earlier nodes` : ''}`,
    `Vessel has ${dvText(have)} (vacuum): ${stages.map(s => `stage ${s.stage} ${dvText(s.dv)}`).join(', ') || 'no powered stages'}`,
  ].join('\n');
  return <div className={`dvb${short > 0.5 ? ' short' : ''}`} title={title} role="img" aria-label={title.replace('\n', '. ')}>
    <div className="dvb-have">{stages.map((s, i) => <i key={s.stage} className={`s${i % 4}`} style={{ width: pct(s.dv, scale) }} />)}</div>
    <div className="dvb-need">
      {before > 0 && <i className="pre" style={{ width: pct(before, scale) }} />}
      <i className="now" style={{ width: pct(need, scale) }} />
      {extra > 0 && <i className="cap" style={{ width: pct(extra, scale) }} />}
    </div>
    <div className="dvb-text">
      <span>{short > 0.5 ? <b>short {dvText(short)}</b> : <>need <b>{extra > 0 ? `${Math.round(before + need)}+${Math.round(extra)} m/s` : dvText(total)}</b></>}</span>
      <span>have <b>{dvText(have)}</b></span>
    </div>
  </div>;
}

export interface TimelineStop { label: string; value?: string; title?: string; tone?: 'burn' | 'arrive' }

/**
 * Ordered event strip: now → burn → arrival. Stops are evenly spaced (waits differ by orders of magnitude), with the
 * wait between two stops written under the line that joins them.
 */
export function Timeline({ stops, gaps }: { stops: readonly TimelineStop[]; gaps: readonly string[] }) {
  return <div className="tl" role="list" aria-label="Plan timeline" style={{ gridTemplateColumns: stops.map(() => 'auto').join(' minmax(24px, 1fr) ') }}>
    {stops.flatMap((s, i) => [
      ...(i > 0 ? [<div key={`g${i}`} className="tl-seg" aria-hidden><i /><span>{gaps[i - 1]}</span></div>] : []),
      <div key={i} role="listitem" className={`tl-stop ${s.tone ?? ''}`} title={s.title}
        aria-label={[s.label, s.value, i > 0 ? `in ${gaps[i - 1]}` : ''].filter(Boolean).join(', ')}>
        <span className="tl-dot" /><span className="tl-label">{s.label}</span>{s.value && <span className="tl-value">{s.value}</span>}
      </div>,
    ])}
  </div>;
}

/**
 * Entry corridor: vacuum periapsis altitude from deep (left: too steep, heat and g) to high (right: skips back out),
 * with the safe band between. Ticks mark the current periapsis (hollow) and the planned one (solid); values off the
 * scale sit at its ends.
 */
export function CorridorGauge({ steep, shallow, current, planned, gLimit }: { steep: number; shallow: number; current: number; planned?: number; gLimit: number }) {
  const width = Math.max(1, shallow - steep), lo = steep - width * 0.6, hi = shallow + width * 0.6;
  const at = (alt: number) => pct(Math.max(lo, Math.min(hi, alt)) - lo, hi - lo);
  const zone = (alt: number) => alt < steep ? `too steep (over ${gLimit} g)` : alt > shallow ? 'too shallow (skips out)' : 'in the corridor';
  const km = (alt: number) => `${(alt / 1000).toFixed(1)} km`;
  const title = [`Periapsis now ${km(current)}: ${zone(current)}`, ...(planned !== undefined ? [`Planned ${km(planned)}: ${zone(planned)}`] : []),
    `Corridor ${km(steep)} – ${km(shallow)}`].join('\n');
  return <div className="cg" title={title} role="img" aria-label={title.replaceAll('\n', '. ')}>
    <div className="cg-bar">
      <i className="cg-steep" style={{ width: at(steep) }} />
      <i className="cg-ok" style={{ left: at(steep), width: pct(width, hi - lo) }} />
      <i className="cg-skip" style={{ left: at(shallow) }} />
      <b className="cg-now" style={{ left: at(current) }} />
      {planned !== undefined && <b className="cg-plan" style={{ left: at(planned) }} />}
    </div>
    <div className="cg-text"><span>steep</span><span>{km(steep)} – {km(shallow)}</span><span>skip</span></div>
  </div>;
}
