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
      <span>{short > 0.5 ? <b>short {dvText(short)}</b> : <>need <b>{dvText(total)}</b></>}</span>
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
