import type { ReactNode } from 'react';
import type { World } from '../../game/world';
import type { TransferWindow } from '../../game/planning/windows';
import { formatDate, formatDuration } from '../../ui/format';
import { dvText, shortDate, shortDuration } from './plannerFormat';

const cost = (w: TransferWindow) => w.dv + (w.captureDv ?? 0);

/** Go-now first, then cheapest; recommend the earliest departure within 5% of the lowest total Δv. */
export function liveOptions(windows: readonly TransferWindow[], ut: number): { live: TransferWindow[]; best?: TransferWindow } {
  const live = windows.filter(w => w.departure > ut + 120)
    .sort((a, b) => Number(b.kind === 'now') - Number(a.kind === 'now') || cost(a) - cost(b));
  const cheapest = Math.min(...live.map(cost));
  const best = live.filter(w => cost(w) <= cheapest * 1.05).sort((a, b) => a.departure - b.departure)[0];
  return { live, best };
}

/**
 * One row per departure: name, wait and total Δv on the first line, a departure + capture Δv bar (scaled to the
 * dearest option) and the trip time on the second. Dates and exact figures are in the row tooltip.
 * Estimates stay selectable until the worker verifies an encounter and the existing apply path installs its node.
 */
export function DepartureOptions({ world, options, busy, onPick, tools }: {
  world: World; options: { target: string; windows: TransferWindow[] }; busy: boolean; onPick(w: TransferWindow): void; tools?: ReactNode;
}) {
  const { live, best } = liveOptions(options.windows, world.ut);
  if (!live.length) return null;
  const max = Math.max(...live.map(cost), 1);
  const name = world.universe.body(options.target).name;
  return <div className="dep" aria-label="Departure options">
    <div className="dep-head">
      <span className="label" title="Estimates ranked by departure + capture Δv. ★ recommends the earliest departure within 5% of the lowest total Δv. Pick one to verify the encounter and create its node.">Departures · {name}</span>
      {tools}
    </div>
    {live.map(w => {
      const title = `${w.kind === 'now' ? 'Go now with a plane change, on the next orbit' : 'Transfer window'}${w === best ? ' (recommended: earliest within 5% of lowest Δv)' : ''}\n`
        + `Depart ${formatDate(w.departure)} · wait ${formatDuration(w.departure - world.ut)}\n`
        + `Departure ~${dvText(w.dv)} · ${w.captureDv === 0 ? 'direct entry (no capture burn)' : `capture ${w.captureDv === undefined ? '—' : `~${dvText(w.captureDv)}`}`} · flight ${formatDuration(w.timeOfFlight)}\n`
        + 'Click to verify and create the node';
      return <button key={w.departure} className={`dep-opt${w === best ? ' best' : ''}`} disabled={busy} title={title} aria-label={title.replace(/\n/g, '. ')} onClick={() => onPick(w)}>
        <span className="dep-name">{w.kind === 'now' ? 'Go now' : 'Window'}{w === best && <span className="pl-star" aria-hidden>★</span>}</span>
        <span className="dep-wait pl-num">in {shortDuration(w.departure - world.ut)}</span>
        <span className="dep-dv pl-num">{dvText(cost(w))}</span>
        <span className="dep-bar"><i className="now" style={{ width: `${(w.dv / max) * 100}%` }} />{w.captureDv !== undefined && <i className="cap" style={{ width: `${(w.captureDv / max) * 100}%` }} />}</span>
        <span className="dep-trip pl-num"><span className="dep-date">{shortDate(w.departure)} · </span>{w.captureDv === 0 ? 'direct entry · ' : ''}{shortDuration(w.timeOfFlight)} trip</span>
      </button>;
    })}
  </div>;
}
