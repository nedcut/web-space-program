import { usePlanner } from './usePlanner';
import type { TransferWindow as DepartureWindow } from '../../game/planning/windows';
import { applyPlanningResult } from '../../game/planning/apply';
import { TransferWindow } from './TransferWindow';
import { useEffect, useState } from 'react';
import type { World } from '../../game/world';
import { timeToApoapsis, timeToPeriapsis } from '../../sim/orbit';
import { formatCountdown, formatDistance, formatDuration } from '../../ui/format';
import { planCircularization } from '../../game/autopilot';
import { useRenderProfile } from './useRenderProfile';
import { getTutorial } from '../../tutorial/runtime';
import type { FlightMap } from '../map/FlightMap';

const OPEN_KEY = 'wsp.mapPlanner.open.v1';
function storedOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

/**
 * Collapsible "Maneuver planner" app shown in map view. Nodes are normally placed by clicking the orbit and shaped
 * with the map gizmo; this panel holds the planning tools (circularize, transfers, transfer windows) and a node list.
 */
export function ManeuverPanel({ world, map }: { world: World; map?: FlightMap }) {
  useRenderProfile();
  const [, force] = useState(0);
  const [open, setOpen] = useState(() => storedOpen() || !!getTutorial());
  const planner = usePlanner(world);
  const [planMsg, setPlanMsg] = useState('');
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [options, setOptions] = useState<{ target: string; windows: DepartureWindow[] } | null>(null);

  // Node list readouts refresh at 4 Hz while the panel is open.
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => force((x) => (x + 1) % 1e6), 250);
    return () => window.clearInterval(id);
  }, [open]);

  const toggle = () => {
    setOpen(o => {
      try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* session only */ }
      return !o;
    });
  };

  const wv = world.active;
  if (!wv || wv.mode === 'prelaunch') return null;

  const header = <button className="btn small" data-tutorial="maneuver" aria-expanded={open} onClick={toggle}
    title="Circularize, transfer planning, transfer windows and node list" style={{ alignSelf: 'flex-start' }}>
    Maneuver planner {open ? '▾' : '▸'}{world.nodes.length ? ` · ${world.nodes.length} node${world.nodes.length > 1 ? 's' : ''}` : ''}
  </button>;
  if (!open) return header;

  const orbit = world.orbitOf(wv);
  const body = world.universe.body(wv.body);

  const add = (when: 'ap' | 'pe' | 'soon') => {
    const t = when === 'ap' ? timeToApoapsis(orbit, world.ut) : when === 'pe' ? timeToPeriapsis(orbit, world.ut) : 120;
    const n = world.addNode(world.ut + (isFinite(t) && t > 5 ? t : 120));
    world.nodes = [...world.nodes].sort((a, b) => a.time - b.time);
    map?.selectNode(n.id);
  };

  const siblings = body.parent === world.universe.sunId
    ? world.universe.body(world.universe.sunId).children.filter(id => id !== body.id).map(id => world.universe.body(id)) : [];
  const targets = [...siblings, ...body.children.map((id) => world.universe.body(id)), ...(body.parent && body.parent !== world.universe.sunId ? [world.universe.body(body.parent)] : [])]
    .filter((b) => b.kind !== 'star')
    .sort((a, b) => (a.orbit?.a ?? 0) - (b.orbit?.a ?? 0));
  const planTransfer = async (id: string, departure?: number) => {
    setPlanMsg('');
    try {
      const { result: plan, snapshot } = await planner.run('transfer', { target: id, ...(departure !== undefined ? { options: { departure } } : {}) });
      if (!plan) { setPlanMsg(departure !== undefined ? 'That departure did not refine to an encounter. Try another option.' : 'No transfer window found'); return; }
      applyPlanningResult(world, snapshot, plan);
      const target = world.universe.body(id), node = world.nodes[0];
      if (map && node) { map.selectNode(node.id); map.frameTransfer(id); }
      // Keep the option list from the first search when the player picks one of its departures.
      if (plan.windows?.length) setOptions({ target: id, windows: plan.windows });
      const wait = plan.node.time - world.ut;
      setPlanMsg(`${target.name} transfer: ${plan.dv.toFixed(0)} m/s, burn in ${formatDuration(wait)}. `
        + `Encounter in ${formatDuration(plan.encounterTime - world.ut)}, periapsis ${formatDistance(plan.periapsisAltitude)}. `
        + `Use Warp below to reach the burn; Assist → Execute next node can fly it.`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setPlanMsg((e as Error).message);
    }
  };
  const planCirc = (at: 'apoapsis' | 'periapsis') => {
    world.nodes = [];
    try {
      planCircularization(world, at);
      setPlanMsg('');
    } catch (e) {
      setPlanMsg((e as Error).message);
    }
  };
  const nodes = [...world.nodes].sort((a, b) => a.time - b.time);

  return (
    <>
    {transferTarget && <TransferWindow world={world} target={transferTarget} onClose={() => setTransferTarget(null)} onPlanned={setPlanMsg} />}
    <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      {header}
      {world.preciseGravity && <div className="label">Precise map path · planners use patched conics. Allow correction burns.</div>}
      <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>Click your orbit to add a node. Drag its handles: green prograde/retrograde, magenta normal, cyan radial. Click the node for exact values.</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn small" onClick={() => add('ap')} disabled={orbit.e >= 1}>Node @ Ap</button>
        <button className="btn small" onClick={() => add('pe')}>Node @ Pe</button>
        <button className="btn small" onClick={() => add('soon')}>+2 min</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn small" onClick={() => planCirc('apoapsis')} disabled={orbit.e >= 1}>Circularize @ Ap</button>
        <button className="btn small" onClick={() => planCirc('periapsis')}>@ Pe</button>
      </div>
      {targets.length > 0 && (
        <select
          className="btn small"
          disabled={!!planner.progress || !!transferTarget}
          value=""
          onChange={(e) => e.target.value && planTransfer(e.target.value)}
          style={{ background: 'var(--panel-solid)', color: 'var(--text)' }}
        >
          <option value="">Plan transfer to…</option>
          {targets.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      )}
      {siblings.length > 0 && <select className="btn small" aria-label="Transfer window destination" disabled={!!planner.progress} value="" onChange={e => { if (e.target.value) setTransferTarget(e.target.value); }} style={{ background: 'var(--panel-solid)', color: 'var(--text)' }}>
        <option value="">Explore transfer windows…</option>
        {siblings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>}
      {planner.progress && <div role="status" style={{ fontSize: 12 }}>
        Planning… {planner.progress.phase} ({Math.round(planner.progress.fraction * 100)}%)
        <progress aria-label="Transfer planning progress" value={planner.progress.fraction} max={1} />
        <button className="btn small" onClick={() => { planner.cancel(); setPlanMsg('Planning cancelled'); }}>Cancel</button>
      </div>}
      {planMsg && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{planMsg}</div>}
      {options && <DepartureOptions world={world} options={options} busy={!!planner.progress} onPick={w => planTransfer(options.target, w.departure)} />}
      {nodes.length > 0 && <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 6, display: 'grid', gap: 4, fontSize: 12 }}>
        {nodes.map((n, i) => <div key={n.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6, alignItems: 'center' }}>
          <button className="btn ghost small" style={{ textAlign: 'left' }} onClick={() => map?.openNode(n.id)} title="Select and open the node menu">
            <span className="mono">#{i + 1} · {Math.hypot(n.prograde, n.normal, n.radial).toFixed(1)} m/s · {formatCountdown(n.time - world.ut)}</span>
          </button>
          {map && <button className="btn small" onClick={() => map.warpToNode(n.id)}>Warp</button>}
          <button className="btn small danger" aria-label={`Delete node ${i + 1}`} onClick={() => map ? map.deleteNode(n.id) : world.removeNode(n.id)}>×</button>
        </div>)}
      </div>}
    </div>
    </>
  );
}

/**
 * The departures the planner found for the last transfer: wait versus Δv, so the player can trade a long wait for
 * a dearer burn now (usually a plane change) or the reverse. Δv values are estimates until picked and refined.
 */
function DepartureOptions({ world, options, busy, onPick }: { world: World; options: { target: string; windows: DepartureWindow[] }; busy: boolean; onPick(w: DepartureWindow): void }) {
  const live = options.windows.filter(w => w.departure > world.ut + 120);
  if (live.length < 2) return null;
  const cheapest = Math.min(...live.map(w => w.dv));
  const soonest = live[0];
  const node = world.nodes[0];
  const current = node ? live.reduce((a, b) => (Math.abs(b.departure - node.time) < Math.abs(a.departure - node.time) ? b : a)) : null;
  const near = (w: DepartureWindow) => !!node && w === current && Math.abs(w.departure - node.time) < Math.max(3600, 0.05 * (w.departure - world.ut));
  return <div style={{ display: 'grid', gap: 3, fontSize: 12 }} aria-label="Departure options">
    <div className="label">Departure options · {world.universe.body(options.target).name}</div>
    {live.map(w => {
      const tags = [w === soonest ? 'soonest' : '', w.dv <= cheapest + 0.5 ? 'cheapest' : '', w === soonest && w.dv > cheapest * 1.1 + 20 ? 'plane change' : ''].filter(Boolean);
      return <button key={w.departure} className="btn ghost small" disabled={busy || near(w)} style={{ textAlign: 'left' }}
        title={near(w) ? 'Planned' : 'Plan this departure (refines the encounter)'} onClick={() => onPick(w)}>
        <span className="mono">{near(w) ? '● ' : '○ '}in {formatDuration(w.departure - world.ut)} · ~{w.dv.toFixed(0)} m/s · flight {formatDuration(w.timeOfFlight)}</span>
        {tags.length > 0 && <span style={{ color: 'var(--text-dim)' }}> · {tags.join(', ')}</span>}
      </button>;
    })}
  </div>;
}
