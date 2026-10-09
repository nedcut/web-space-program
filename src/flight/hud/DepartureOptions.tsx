import type { World } from '../../game/world';
import type { TransferWindow } from '../../game/planning/windows';
import { formatDate, formatDuration } from '../../ui/format';

/** Estimates stay selectable until the worker verifies an encounter and the existing apply path installs its node. */
export function DepartureOptions({ world, options, busy, onPick }: {
  world: World; options: { target: string; windows: TransferWindow[] }; busy: boolean; onPick(w: TransferWindow): void;
}) {
  const cost = (w: TransferWindow) => w.dv + (w.captureDv ?? 0);
  const live = options.windows.filter(w => w.departure > world.ut + 120)
    .sort((a, b) => Number(b.kind === 'now') - Number(a.kind === 'now') || cost(a) - cost(b));
  if (!live.length) return null;
  const best = live.reduce((a, b) => cost(a) < cost(b) ? a : b);
  return <div style={{ display: 'grid', gap: 4, fontSize: 12 }} aria-label="Departure options">
    <div className="label">Upcoming windows · {world.universe.body(options.target).name}</div>
    <div style={{ color: 'var(--text-dim)' }}>Best by departure + capture Δv. Estimates; select to verify and create a node.</div>
    {live.map(w => <button key={w.departure} className="btn ghost small" disabled={busy}
      style={{ textAlign: 'left', whiteSpace: 'normal' }} title="Plan this departure (verifies the encounter)" onClick={() => onPick(w)}>
      <div>{w.kind === 'now' ? 'Go now (with plane change) · next orbit' : 'Transfer window'}{w === best ? ' · best Δv' : ''}</div>
      <div className="mono">Depart {formatDate(w.departure)} · wait {formatDuration(w.departure - world.ut)}</div>
      <div className="mono">Departure ~{w.dv.toFixed(0)} m/s · capture {w.captureDv === undefined ? '—' : `~${w.captureDv.toFixed(0)} m/s`} · flight {formatDuration(w.timeOfFlight)}</div>
    </button>)}
  </div>;
}
