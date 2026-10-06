import { useEffect, useReducer, useRef, useState } from 'react';
import type { FlightController } from '../controller';
import type { ManeuverNode } from '../../sim/orbit/api';
import { MapContextMenu, MapInfoCard, clampToParent } from '../../ui/map/MapContextMenu';
import type { MapObject } from '../../ui/map/mapActions';
import { AXIS_COLORS } from '../../render/map/mapIcons';
import { period } from '../../sim/orbit';
import { formatDistance, formatDuration, formatSpeed } from '../../util/format';
import { bindingLabel } from '../../input/bindings';
import { cross, dot, length } from '../../util/vec3';
import { qRotate } from '../../util/quat';
import { nodeSummary } from './nodeInfo';
import type { FlightMap } from './FlightMap';

const BODY_KIND = { star: 'Star', planet: 'Planet', dwarf: 'Dwarf planet', moon: 'Moon', asteroid: 'Asteroid', comet: 'Comet' } as const;

/** Re-render on menu changes plus a low-rate tick for live readouts. */
function useMapUi(ui: FlightMap, hz = 8) {
  const [, bump] = useReducer((n: number) => (n + 1) % 1e6, 0);
  useEffect(() => ui.subscribe(bump), [ui]);
  useEffect(() => { const id = window.setInterval(bump, 1000 / hz); return () => window.clearInterval(id); }, [hz]);
}

/** Map-mode overlay: node menu, context menu, info card and the compact orbit readout. */
export function MapOverlay({ controller: c }: { controller: FlightController }) {
  const ui = c.mapUi;
  useMapUi(ui);
  const { node: nodeId, context, info } = ui.menus;
  const node = nodeId !== null ? c.world.nodes.find(n => n.id === nodeId) : undefined;
  return <>
    <OrbitReadout controller={c} />
    {node && <NodeMenu controller={c} node={node} />}
    {context?.obj && <MapContextMenu x={context.x} y={context.y} title={ui.name(context.obj)}
      subtitle={context.obj.kind === 'vessel' ? (context.obj.id === c.world.activeId ? 'Active vessel' : 'Vessel') : BODY_KIND[c.world.universe.body(context.obj.id).kind]}
      actions={ui.actions(context.obj)} onAction={id => ui.run(id, context.obj!)} onClose={() => ui.closeMenus()} />}
    {context?.point && <MapContextMenu x={context.x} y={context.y} title={context.point.label}
      subtitle={context.point.time !== undefined ? `T−${formatDuration(context.point.time - c.world.ut)}` : undefined}
      actions={ui.pointActions(context.point)} onAction={id => ui.runPoint(id, context.point!)} onClose={() => ui.closeMenus()} />}
    {info && <InfoCard controller={c} obj={info} />}
  </>;
}

function InfoCard({ controller: c, obj }: { controller: FlightController; obj: MapObject }) {
  const w = c.world, close = () => c.mapUi.closeInfo();
  if (obj.kind === 'body') {
    const b = w.universe.bodies.get(obj.id);
    if (!b) return null;
    return <MapInfoCard title={b.name} onClose={close} rows={[
      ['Radius', formatDistance(b.radius)], ['Surface gravity', `${b.surfaceGravity.toFixed(2)} m/s²`],
      ['Sphere of influence', Number.isFinite(b.soi) ? formatDistance(b.soi) : '∞'],
      ['Atmosphere', b.atmosphere ? formatDistance(b.atmosphere.height) : 'None'],
      ['Orbital period', b.orbitalPeriod ? formatDuration(b.orbitalPeriod) : '—'],
      ['Rotation', formatDuration(Math.abs(b.rotationPeriod))],
    ]} />;
  }
  const v = w.vessels.get(obj.id);
  if (!v) return null;
  let rows: [string, string][] = [['Situation', v.mode === 'prelaunch' ? 'Prelaunch' : v.state.situation], ['Body', w.universe.body(v.body).name], ['Mass', `${(v.state.mass / 1000).toFixed(2)} t`]];
  try {
    if (v.state.situation === 'flying' && v.mode !== 'prelaunch') {
      const o = w.orbitSummary(v);
      rows = [...rows, ['Apoapsis', o.orbit.e < 1 ? formatDistance(o.ap) : 'escape'], ['Periapsis', formatDistance(o.pe)], ['Period', formatDuration(period(o.orbit))]];
    }
  } catch { /* degenerate orbit */ }
  return <MapInfoCard title={v.state.name} onClose={close} rows={rows} />;
}

/** Equatorial inclination (degrees) of the active orbit. */
function inclination(c: FlightController): number {
  const w = c.world, wv = w.active!;
  const s = w.relativeState(wv), h = cross(s.position, s.velocity), north = qRotate(w.universe.ephem.bodyRotation(wv.body, w.ut), { x: 0, y: 0, z: 1 });
  const lh = length(h);
  return lh > 0 ? Math.acos(Math.max(-1, Math.min(1, dot(h, north) / lh))) * 180 / Math.PI : 0;
}

function OrbitReadout({ controller: c }: { controller: FlightController }) {
  const w = c.world, wv = w.active;
  if (!wv || wv.mode === 'prelaunch' || wv.state.situation !== 'flying') return <div className="panel map-orbit-info"><span className="hint">{hints()}</span></div>;
  let o: ReturnType<typeof w.orbitSummary>;
  try { o = w.orbitSummary(wv); } catch { return null; }
  const body = w.universe.body(wv.body);
  const bound = o.orbit.e < 1;
  const T = period(o.orbit);
  return <div className="panel map-orbit-info" aria-label="Orbit">
    <span className="title">Orbit · {body.name}{c.mapUi.focus ? ` · viewing ${c.mapUi.name(c.mapUi.focus)}` : ''}</span>
    <span className="k">Ap</span><span className="mono">{bound ? formatDistance(o.ap) : 'escape'}</span><span className="mono">{bound ? `T−${formatDuration(o.timeToAp)}` : ''}</span>
    <span className="k">Pe</span><span className="mono" style={{ color: o.pe < (body.atmosphere?.height ?? 0) ? 'var(--warn)' : undefined }}>{formatDistance(o.pe)}</span><span className="mono">{Number.isFinite(o.timeToPe) ? `T−${formatDuration(o.timeToPe)}` : ''}</span>
    <span className="k">Inc</span><span className="mono">{inclination(c).toFixed(2)}°</span><span className="mono">{Number.isFinite(T) ? `Period ${formatDuration(T)}` : `e ${o.orbit.e.toFixed(3)}`}</span>
    <span className="hint">{hints()}</span>
  </div>;
}

function hints() {
  return `Click orbit: add node · Right-click object: menu · Double-click: focus · ${bindingLabel('mapFocusNext')}/Shift+${bindingLabel('mapFocusNext')}: cycle focus · ${bindingLabel('mapFocusHome')}: vessel`;
}

const AXES: { axis: 'prograde' | 'normal' | 'radial'; label: string }[] = [
  { axis: 'prograde', label: 'Prograde' }, { axis: 'normal', label: 'Normal' }, { axis: 'radial', label: 'Radial' },
];

/** Numeric Δv field: shows the live value, edits commit on Enter/blur. */
function DvField({ value, onCommit, label }: { value: number; onCommit: (v: number) => void; label: string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => { if (text !== null) { const v = Number(text); if (Number.isFinite(v)) onCommit(v); } setText(null); };
  return <input aria-label={`${label} m/s`} inputMode="decimal" value={text ?? value.toFixed(1)}
    onFocus={e => { setText(value.toFixed(1)); e.currentTarget.select(); }}
    onChange={e => setText(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } if (e.key === 'Escape') { setText(null); e.currentTarget.blur(); } e.stopPropagation(); }} />;
}

function NodeMenu({ controller: c, node }: { controller: FlightController; node: ManeuverNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const ui = c.mapUi, w = c.world;
  // Follow the node on screen every frame without re-rendering React.
  useEffect(() => {
    let raf = 0;
    const follow = () => {
      let p = c.map.nodeScreenPosition(node.id);
      const host = ref.current?.offsetParent as HTMLElement | null | undefined;
      if (p && host && (p.x < 0 || p.y < 0 || p.x > host.clientWidth || p.y > host.clientHeight)) p = null;
      if (ref.current) {
        ref.current.style.visibility = p ? 'visible' : 'hidden';
        if (p) clampToParent(ref.current, p.x + 26, p.y - 40);
      }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) { e.stopPropagation(); c.mapUi.closeMenus(); } };
    window.addEventListener('keydown', key, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key, true); };
  }, [c, node.id]);
  const s = nodeSummary(w, node);
  const set = (axis: 'prograde' | 'normal' | 'radial', v: number) => { node[axis] = v; w.nodes = [...w.nodes]; };
  const step = c.map.fineTune ? 0.1 : 1;
  const index = [...w.nodes].sort((a, b) => a.time - b.time).indexOf(node) + 1;
  return <div ref={ref} className="panel map-node-menu" role="dialog" aria-label="Maneuver node" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <div className="map-menu-head" style={{ marginBottom: 0 }}>
      <strong>Node {index}{w.nodes.length > 1 ? ` of ${w.nodes.length}` : ''} · T−{formatDuration(node.time - w.ut)}</strong>
      <button className="btn ghost small" aria-label="Close node menu" onClick={() => ui.closeMenus()}>×</button>
    </div>
    {AXES.map(({ axis, label }) => <div className="row" key={axis}>
      <span className="label" style={{ color: AXIS_COLORS[axis] }}>{label}</span>
      <button className="btn small" aria-label={`${label} −${step}`} onClick={() => set(axis, node[axis] - step)}>−</button>
      <DvField label={label} value={node[axis]} onCommit={v => set(axis, v)} />
      <button className="btn small" aria-label={`${label} +${step}`} onClick={() => set(axis, node[axis] + step)}>+</button>
    </div>)}
    <div className="summary mono">
      <span>Δv</span><span>{formatSpeed(s.dv)}</span>
      <span>Burn</span><span>{Number.isFinite(s.burn) ? `${formatDuration(s.burn)} (start T−${formatDuration(node.time - w.ut - s.burn / 2)})` : 'no active engine'}</span>
      <span>After</span><span style={{ color: '#ff9d3c' }}>Ap {Number.isFinite(s.ap) ? formatDistance(s.ap) : 'escape'} · Pe {formatDistance(s.pe)}</span>
      {s.encounter && <><span>Encounter</span><span style={{ color: 'var(--good)' }}>{w.universe.body(s.encounter).name}</span></>}
    </div>
    <div className="actions">
      <button className="btn small" disabled={!Number.isFinite(s.orbitPeriod) || node.time - s.orbitPeriod < w.ut + 5} onClick={() => ui.shiftOrbit(node.id, -1)}>−1 orbit</button>
      <button className="btn small" disabled={!Number.isFinite(s.orbitPeriod)} onClick={() => ui.shiftOrbit(node.id, 1)}>+1 orbit</button>
      <button className="btn small" disabled={!!c.network || !!c.assist} onClick={() => ui.warpToNode(node.id)}>Warp to</button>
    </div>
    <div className="actions">
      <label className="fine"><input type="checkbox" checked={c.map.fineTune} onChange={e => { c.map.fineTune = e.target.checked; refresh(); }} style={{ width: 'auto' }} /> Fine tune</label>
      <button className="btn small" onClick={() => { node.prograde = node.normal = node.radial = 0; w.nodes = [...w.nodes]; }}>Zero</button>
      <button className="btn small danger" onClick={() => ui.deleteNode(node.id)}>Delete</button>
    </div>
  </div>;
}
