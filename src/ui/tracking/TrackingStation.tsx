import { useEffect, useRef, useState } from 'react';
import { game, updateSettings, useGame } from '../../game/store';
import { World, type WorldVessel } from '../../game/world';
import { Universe } from '../../game/universe';
import { deserializeWorld, serializeWorld, saveWorldToStorage } from '../../game/persistence';
import { PART_CATALOG } from '../../data/parts';
import { RAILS_WARP, warpRate } from '../../game/timewarp';
import type { Body } from '../../sim/bodies/types';
import { formatDate, formatDistance, formatDuration } from '../format';
import { TrackingView, type TrackingFocus } from './trackingView';
import './tracking.css';

const distance = (n: number) => Number.isFinite(n) ? formatDistance(n) : '∞';

export default function TrackingStation() {
  const [world] = useState(() => {
    const s = game.get();
    // Clone the snapshot: deserialization restores mutable vessel runtime objects.
    if (s.resumeWorld) {
      try {
        return deserializeWorld(structuredClone(s.resumeWorld), PART_CATALOG);
      } catch (e) {
        console.error('Tracking: could not load world', e);
      }
    }
    return new World(new Universe(s.scalePreset), PART_CATALOG, s.ut, s.mode);
  });
  const overlay = useGame(s => s.settings.commsOverlay);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<TrackingView | null>(null);
  const [, refresh] = useState(0);
  const [focus, setFocus] = useState<TrackingFocus>({ kind: 'body', id: world.universe.sunId });
  const [terminate, setTerminate] = useState<string | null>(null);
  const update = () => refresh((n) => n + 1);
  useEffect(() => {
    const renderer = new TrackingView(host.current!, world, update, setFocus);
    view.current = renderer;
    // Start on the player's fleet rather than a whole-solar-system view.
    const first = (world.activeId && world.vessels.get(world.activeId)) || world.vessels.values().next().value;
    if (first) renderer.setFocus({ kind: 'vessel', id: first.state.id });
    return () => {
      renderer.dispose();
      view.current = null;
      game.set({ resumeWorld: serializeWorld(world), mode: world.mode, ut: world.ut });
      saveWorldToStorage('autosave', world);
    };
  }, [world]);

  const exit = (scene: 'spaceCenter' | 'flight' | 'pedia') => {
    world.warp = { mode: 'rails', index: 0 };
    saveWorldToStorage('autosave', world);
    game.set({ resumeWorld: serializeWorld(world), mode: world.mode, ut: world.ut, launchPending: false, scene });
  };
  const remove = (id: string) => {
    world.vessels.delete(id);
    if (world.activeId === id) { world.activeId = null; world.nodes = []; }
    if (focus.kind === 'vessel' && focus.id === id) view.current?.setFocus({ kind: 'body', id: world.universe.sunId });
    update();
  };
  const groups = new Map<string, WorldVessel[]>();
  for (const v of world.vessels.values()) {
    const body = world.universe.body(v.body);
    const o = v.state.situation === 'flying' && v.mode !== 'prelaunch' ? world.orbitSummary(v) : null;
    const group = !o ? `Landed on ${body.name}` : o.orbit.e >= 1 ? 'Escaping' : o.pe < (body.atmosphere?.height ?? 0) ? 'Sub-orbital' : `Orbiting ${body.name}`;
    groups.set(group, [...(groups.get(group) ?? []), v]);
  }
  const body = focus.kind === 'body' ? world.universe.body(focus.id) : world.universe.body(world.vessels.get(focus.id)?.body ?? world.universe.sunId);
  const tree = (b: Body) => <div key={b.id}>
    {b.children.length ? <details open={b.kind === 'star'}><summary><button className="btn ghost small" onClick={() => view.current?.setFocus({ kind: 'body', id: b.id })}>{b.name}</button></summary><div className="tracking-children">{b.children.map((id) => tree(world.universe.body(id)))}</div></details>
      : <button className="btn ghost small" onClick={() => view.current?.setFocus({ kind: 'body', id: b.id })}>{b.name}</button>}
  </div>;

  return <div className="fullscreen tracking-station">
    <div className="fullscreen" ref={host} />
    <div className="overlay">
      <header className="panel tracking-header">
        <div><div className="label">Web Space Program</div><h2>Tracking Station</h2></div>
        <div className="tracking-clock"><div className="mono">{formatDate(world.ut)}</div><label className="label">Time warp <select aria-label="Time warp" value={world.warp.index} onChange={(e) => { world.warp = { mode: 'rails', index: Number(e.target.value) }; update(); }}>{RAILS_WARP.map((r, i) => <option key={r} value={i}>{r.toLocaleString()}×</option>)}</select></label><span className="mono"> {warpRate(world.warp).toLocaleString()}×</span></div>
        <label className="label"><input type="checkbox" checked={overlay} onChange={e => updateSettings({ commsOverlay: e.target.checked })} /> Signal links · red weak / green strong</label>
        <button className="btn small" onClick={() => void import('../Spacepedia').then(m => { exit('pedia'); m.openPedia('tracking'); })}>Spacepedia</button>
        <button className="btn small" onClick={() => exit('spaceCenter')}>Back to Space Center</button>
      </header>
      <aside className="panel tracking-fleet"><div className="label">Vessels · {world.vessels.size}</div>
        {!world.vessels.size && <p className="tracking-muted">No vessels to track yet. Launch a vehicle from the Space Center to begin a mission.</p>}
        {[...groups].map(([group, vessels]) => <section key={group}><h3 className="label">{group}</h3>{vessels.map((v) => {
          const o = v.state.situation === 'flying' && v.mode !== 'prelaunch' ? world.orbitSummary(v) : null;
          return <article className="tracking-vessel" key={v.state.id}><strong>{v.state.name}</strong><div className="tracking-muted">{world.universe.body(v.body).name} · {v.mode === 'prelaunch' ? 'Prelaunch' : v.state.situation}</div><div className="mono tracking-apsides">Ap {o ? distance(o.ap) : '—'} / Pe {o ? distance(o.pe) : '—'}</div><div className="tracking-actions">
            <button className="btn small" onClick={() => view.current?.setFocus({ kind: 'vessel', id: v.state.id })}>Focus</button>
            <button className="btn small" onClick={() => { if (world.activeId !== v.state.id) world.nodes = []; world.activeId = v.state.id; exit('flight'); }}>Fly</button>
            {v.body === 'earth' && (v.mode === 'prelaunch' || v.state.situation === 'landed' || v.state.situation === 'splashed') && <button className="btn small" onClick={() => { if (world.recoverVessel(v.state.id)) { if (focus.kind === 'vessel' && focus.id === v.state.id) view.current?.setFocus({ kind: 'body', id: 'earth' }); update(); } }}>Recover</button>}
            <button className="btn small danger" onClick={() => setTerminate(v.state.id)}>Terminate</button>
          </div></article>;
        })}</section>)}
      </aside>
      <aside className="tracking-right"><details className="panel tracking-bodies" open><summary className="label">Celestial bodies</summary>{tree(world.universe.body(world.universe.sunId))}</details>
        <section className="panel tracking-info"><div className="label">{focus.kind === 'vessel' ? 'Reference body' : 'Focused body'} · {world.universe.preset} scale</div><h2>{body.name}</h2><p className="tracking-muted">{body.description ?? 'No description available.'}</p><dl>
          {Object.entries({ Radius: distance(body.radius), 'Surface gravity': `${body.surfaceGravity.toFixed(2)} m/s²`, 'Sphere of influence': distance(body.soi), 'Atmosphere height': body.atmosphere ? distance(body.atmosphere.height) : 'None', 'Surface pressure': `${((body.atmosphere?.surfacePressure ?? 0) / 1000).toFixed(2)} kPa`, 'Orbital period': body.orbitalPeriod ? formatDuration(body.orbitalPeriod) : '—', Rotation: `${formatDuration(Math.abs(body.rotationPeriod))}${body.rotationPeriod < 0 ? ' (retrograde)' : ''}`, Moons: body.children.filter((id) => world.universe.body(id).kind === 'moon').length }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl></section>
      </aside>
      <footer className="panel tracking-help">Drag to orbit · Scroll to zoom · Double-click an icon to focus<br />Warp is limited by the active vessel’s altitude and encounter safety.</footer>
      {terminate && <div className="tracking-modal"><section className="panel" role="dialog" aria-modal="true" aria-labelledby="terminate-title"><h2 id="terminate-title">Terminate vessel?</h2><p>{world.vessels.get(terminate)?.state.name} will be permanently removed from this world.</p><div className="tracking-actions"><button className="btn" onClick={() => setTerminate(null)}>Cancel</button><button className="btn danger" onClick={() => { remove(terminate); setTerminate(null); }}>Confirm termination</button></div></section></div>}
    </div>
  </div>;
}
