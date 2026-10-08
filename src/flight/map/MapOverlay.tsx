import { useEffect, useReducer, useRef, useState } from 'react';
import type { FlightController } from '../controller';
import type { ManeuverNode } from '../../sim/orbit/api';
import { MapContextMenu, MapInfoCard, clampToParent } from '../../ui/map/MapContextMenu';
import type { MapObject } from '../../ui/map/mapActions';
import { AXIS_COLORS } from '../../render/map/mapIcons';
import { period } from '../../sim/orbit';
import { formatCountdown, formatDistance, formatDuration, formatSpeed } from '../../util/format';
import { bindingLabel } from '../../input/bindings';
import { bodyBreadcrumbs } from '../../render/map/presentation';
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
    <MapReadout controller={c} />
    {node && <NodeMenu controller={c} node={node} />}
    {context?.obj && <MapContextMenu x={context.x} y={context.y} title={ui.name(context.obj)}
      subtitle={context.obj.kind === 'vessel' ? (context.obj.id === c.world.activeId ? 'Active vessel' : 'Vessel') : BODY_KIND[c.world.universe.body(context.obj.id).kind]}
      actions={ui.actions(context.obj)} onAction={id => ui.run(id, context.obj!)} onClose={() => ui.closeMenus()} />}
    {context?.point && <MapContextMenu x={context.x} y={context.y} title={context.point.label}
      subtitle={context.point.time !== undefined ? formatCountdown(context.point.time - c.world.ut) : undefined}
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

/** Bottom-right map readout: focus path, orbit period/eccentricity and the map gestures (Ap/Pe/Inc are in the HUD strip). */
function MapReadout({ controller: c }: { controller: FlightController }) {
  const w = c.world, wv = w.active, ui = c.mapUi;
  const f = ui.focus;
  const focusBody = f?.kind === 'body' ? f.id : f?.kind === 'vessel' ? w.vessels.get(f.id)?.body : wv?.body;
  const body = focusBody ? w.universe.bodies.get(focusBody) : undefined;
  const path = body ? bodyBreadcrumbs(body, w.universe.bodies).map(b => b.name).join(' › ') : '';
  let orbit: string | null = null;
  try {
    if (wv && wv.mode !== 'prelaunch' && wv.state.situation === 'flying') {
      const o = w.orbitOf(wv), T = period(o);
      orbit = `${Number.isFinite(T) ? `Period ${formatDuration(T)}` : 'Escape trajectory'} · e ${o.e.toFixed(3)}`;
    }
  } catch { /* degenerate orbit */ }
  return <div className="panel map-readout" aria-label="Map focus">
    <span className="title">{f ? `Viewing ${ui.name(f)}` : `Viewing ${body?.name ?? 'body'} · ${wv?.state.name ?? 'vessel'}`}</span>
    {path && <span className="path">{path}</span>}
    {orbit && <span className="mono">{orbit}</span>}
    <button className="btn ghost small" onClick={() => {
      const l = ui.landing;
      if (!l.enabled) { l.enabled = true; l.attitude = 'hold'; }
      else if (l.attitude === 'hold') l.attitude = 'retrograde';
      else l.enabled = false;
    }}>Landing: {ui.landing.enabled ? ui.landing.attitude === 'hold' ? 'hold attitude' : 'surface retrograde' : 'off'}</button>
    {ui.landing.enabled && <span className="hint">Unpowered · drag, heating, deployed chutes · no future staging</span>}
    {ui.landing.status && <span role="status">{ui.landing.status}</span>}
    <button className="btn ghost small" onClick={() => ui.frameOrbit()}>Frame active orbit</button>
    <span className="hint">{hints()}</span>
  </div>;
}

function hints() {
  return `Click orbit: add node · Right-click: menu · Double-click: focus · ${bindingLabel('mapFocusNext')} / Shift+${bindingLabel('mapFocusNext')}: cycle focus · ${bindingLabel('mapFocusHome')}: back to vessel`;
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
      <strong>Node {index}{w.nodes.length > 1 ? ` of ${w.nodes.length}` : ''} · {formatCountdown(node.time - w.ut)}</strong>
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
      <span>Burn</span><span>{Number.isFinite(s.burn) ? `${formatDuration(s.burn)} (start ${formatCountdown(node.time - w.ut - s.burn / 2)})` : 'no active engine'}</span>
      <span>After</span><span style={{ color: '#ff9d3c' }}>Ap {Number.isFinite(s.ap) ? formatDistance(s.ap) : 'escape'} · Pe {formatDistance(s.pe)}</span>
      {s.encounter && <><span>Encounter</span><span style={{ color: s.encounterPe !== undefined && s.encounterPe < 0 ? 'var(--bad)' : 'var(--good)' }}>
        {w.universe.body(s.encounter).name}{s.encounterPe !== undefined ? ` · Pe ${s.encounterPe < 0 ? 'impact' : formatDistance(s.encounterPe)}` : ''}
      </span></>}
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
