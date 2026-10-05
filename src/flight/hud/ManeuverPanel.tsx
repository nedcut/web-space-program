import { usePlanner } from './usePlanner';
import { applyPlanningResult } from '../../game/planning/apply';
import { TransferWindow } from './TransferWindow';
import { useEffect, useRef, useState } from 'react';
import type { World } from '../../game/world';
import { timeToApoapsis, timeToPeriapsis, burnTimeEstimate, periapsisRadius, apoapsisRadius } from '../../sim/orbit';
import { formatDistance, formatDuration } from '../../ui/format';
import { computeStageDeltaV } from '../../sim/vessel';
import { planCircularization } from '../../game/autopilot';
import { thrustLimit } from '../../sim/vessel/tweaks';

/**
 * Maneuver planner shown in map view. Nodes are placed by time (Ap / Pe / custom offset) and shaped with
 * press-and-hold "jog" controls whose rate accelerates the longer you hold (fine control without a gizmo).
 */
export function ManeuverPanel({ world }: { world: World }) {
  const [, force] = useState(0);
  const planner = usePlanner(world);
  const [planMsg, setPlanMsg] = useState('');
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const holdRef = useRef<{ axis: 'prograde' | 'normal' | 'radial' | 'time'; dir: number; t0: number } | null>(null);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const h = holdRef.current;
      const node = world.nodes[0];
      if (h && node) {
        const held = (now - h.t0) / 1000;
        const rate = Math.min(500, 2 * Math.pow(3, held)); // m/s per second, accelerating
        if (h.axis === 'time') {
          const wv = world.active;
          const T = wv ? 2 * Math.PI * Math.sqrt(Math.abs(world.orbitOf(wv).a) ** 3 / world.orbitOf(wv).mu) : 1000;
          node.time = Math.max(world.ut + 5, node.time + h.dir * dt * Math.min(T / 10, 5 * Math.pow(3, held)));
        } else {
          node[h.axis] += h.dir * rate * dt;
        }
        world.nodes = [...world.nodes];
      }
      force((x) => (x + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const up = () => (holdRef.current = null);
    window.addEventListener('pointerup', up);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerup', up);
    };
  }, [world]);

  const wv = world.active;
  if (!wv || wv.mode === 'prelaunch') return null;
  const orbit = world.orbitOf(wv);
  const node = world.nodes[0];
  const body = world.universe.body(wv.body);

  const add = (when: 'ap' | 'pe' | 'soon') => {
    const t = when === 'ap' ? timeToApoapsis(orbit, world.ut) : when === 'pe' ? timeToPeriapsis(orbit, world.ut) : 120;
    world.nodes = [];
    world.addNode(world.ut + (isFinite(t) && t > 5 ? t : 120));
  };

  const siblings = body.parent === world.universe.sunId
    ? world.universe.body(world.universe.sunId).children.filter(id => id !== body.id).map(id => world.universe.body(id)) : [];
  const targets = [...siblings, ...body.children.map((id) => world.universe.body(id)), ...(body.parent && body.parent !== world.universe.sunId ? [world.universe.body(body.parent)] : [])]
    .filter((b) => b.kind !== 'star')
    .sort((a, b) => (a.orbit?.a ?? 0) - (b.orbit?.a ?? 0));
  const planTransfer = async (id: string) => {
    setPlanMsg('');
    try {
      const { result: plan, snapshot } = await planner.run('transfer', { target: id });
      if (plan) applyPlanningResult(world, snapshot, plan);
      setPlanMsg(plan ? `Transfer planned: ${plan.dv.toFixed(0)} m/s, burn in ${formatDuration(plan.node.time - world.ut)}. Warp ahead with “.”, then use Assist → Execute next node.` : 'No transfer window found');
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

  const jog = (axis: 'prograde' | 'normal' | 'radial' | 'time', dir: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      holdRef.current = { axis, dir, t0: performance.now() };
    },
  });

  let summary: { dv: number; burn: number; ap: number; pe: number; next?: string } | null = null;
  if (node) {
    const dv = Math.hypot(node.prograde, node.normal, node.radial);
    const thrust = wv.state.parts.reduce((s, p) => {
      const e = p.def.modules.find((m) => m.type === 'engine');
      return s + (e && e.type === 'engine' && p.engine?.ignited ? e.maxThrustVac * thrustLimit(p) : 0);
    }, 0);
    let isp = 300;
    try {
      const st = computeStageDeltaV(wv.state, 0, body.surfaceGravity)[0];
      if (st) isp = st.isp;
    } catch {
      /* keep default */
    }
    const patches = world.trajectory();
    const after = patches.find((p) => p.startTime >= node.time - 1e-3) ?? patches[patches.length - 1];
    const ob = after ? world.universe.body(after.orbit.body) : body;
    summary = {
      dv,
      burn: thrust > 0 ? burnTimeEstimate(dv, thrust, wv.state.mass, isp) : Infinity,
      ap: after ? apoapsisRadius(after.orbit) - ob.radius : NaN,
      pe: after ? periapsisRadius(after.orbit) - ob.radius : NaN,
      next: patches.find((p) => p.endReason === 'soiEnter')?.nextBody,
    };
  }

  const Row = ({ label, axis, color, value }: { label: string; axis: 'prograde' | 'normal' | 'radial'; color: string; value: number }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '74px 34px 1fr 34px', gap: 6, alignItems: 'center' }}>
      <span className="label" style={{ color, letterSpacing: '0.06em' }}>{label}</span>
      <button className="btn small" {...jog(axis, -1)}>−</button>
      <span className="mono" style={{ textAlign: 'center' }}>{value.toFixed(1)}</span>
      <button className="btn small" {...jog(axis, 1)}>+</button>
    </div>
  );

  return (
    <>
    {transferTarget && <TransferWindow world={world} target={transferTarget} onClose={() => setTransferTarget(null)} onPlanned={setPlanMsg} />}
    <div data-tutorial="maneuver" className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      <div className="label">Maneuver planner</div>
      {world.preciseGravity && <div className="label">Precise map path · planners use patched conics. Allow correction burns.</div>}
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
      {node && summary && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '74px 34px 1fr 34px', gap: 6, alignItems: 'center' }}>
            <span className="label">Time</span>
            <button className="btn small" {...jog('time', -1)}>◀</button>
            <span className="mono" style={{ textAlign: 'center', fontSize: 12 }}>T−{formatDuration(node.time - world.ut)}</span>
            <button className="btn small" {...jog('time', 1)}>▶</button>
          </div>
          <Row label="Prograde" axis="prograde" color="#d8ff3c" value={node.prograde} />
          <Row label="Normal" axis="normal" color="#d066ff" value={node.normal} />
          <Row label="Radial" axis="radial" color="#4fd8ff" value={node.radial} />
          <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 12 }}>
            <span className="label">Δv</span><span className="mono">{summary.dv.toFixed(1)} m/s</span>
            <span className="label">Burn</span><span className="mono">{formatDuration(summary.burn)}</span>
            <span className="label">New Ap</span><span className="mono">{isFinite(summary.ap) ? formatDistance(summary.ap) : 'escape'}</span>
            <span className="label">New Pe</span><span className="mono">{formatDistance(summary.pe)}</span>
            {summary.next && (<><span className="label">Encounter</span><span className="mono" style={{ color: 'var(--good)' }}>{world.universe.body(summary.next).name}</span></>)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn small" onClick={() => { node.prograde = node.normal = node.radial = 0; world.nodes = [...world.nodes]; }}>Zero</button>
            <button className="btn small danger" onClick={() => world.removeNode(node.id)}>Delete</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Drag the node along its orbit or drag the coloured handles to adjust Δv. SAS → MNV points at the burn. Start the burn half the burn time before the node.</div>
        </>
      )}
    </div>
    </>
  );
}
