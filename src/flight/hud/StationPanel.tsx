import { useEffect, useState } from 'react';
import { RESOURCES } from '../../data/resources';
import type { World } from '../../game/world';
import { controlPartUid, stationModules, type StationModule } from '../../sim/vessel';
import { RESOURCE_COLORS } from '../../ui/inspector/resources';
import { formatDistance } from '../../ui/format';
import { length, sub } from '../../util/vec3';
import { hoverPorts, portHover } from './PortHighlight';
import { portSize, SWITCH_RANGE } from './TargetPanel';
import './station.css';

/** What the overview can do (FlightController methods in flight). */
export interface StationActions {
  controlFrom(uid: number): void;
  transferCrew(astronautId: string, uid: number): void;
  switchTo(vesselId: string): void;
  setTarget(vesselId: string, portUid: number | null): void;
  undock(portUid: number): void;
  eva(astronautId: string): void;
}

/** A free seat somewhere in the complex that crew can move to. */
interface Berth { uid: number; label: string; free: number }

/** Inline "→ module" buttons up to this many destinations; more fall back to one dropdown. */
const INLINE_MOVES = 2;
const fmtMass = (kg: number) => (kg < 1000 ? `${kg.toFixed(0)} kg` : `${(kg / 1000).toFixed(kg < 10_000 ? 2 : 1)} t`);

/** Free seats per cabin, labelled by module (and by cabin only when a module has several). */
export function berths(modules: StationModule[]): Berth[] {
  const out: Berth[] = [];
  for (const m of modules) for (const c of m.cabins) {
    const free = c.seats - c.crew.length;
    if (free > 0) out.push({ uid: c.uid, label: m.cabins.length > 1 ? `${m.name} · ${c.name}` : m.name, free });
  }
  return out;
}

/** Vessels within physics range of `world.active`, nearest first. */
export function nearbyVessels(world: World): { id: string; name: string; distance: number; ports: number }[] {
  const act = world.active;
  if (!act) return [];
  const out: { id: string; name: string; distance: number; ports: number }[] = [];
  for (const wv of world.vessels.values()) {
    if (wv === act || wv.state.destroyed) continue;
    const d = length(sub(wv.state.position, act.state.position));
    if (d < SWITCH_RANGE) out.push({ id: wv.state.id, name: wv.state.name, distance: d, ports: wv.state.parts.filter(p => p.def.modules.some(m => m.type === 'dockingPort')).length });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * Station overview: the active vessel's docked modules with their crew, control points, ports and supplies, plus
 * the vessels around it. Everything is one click: move crew, control from a part, undock, target, fly. Re-derived
 * from the World on each HUD telemetry update while the window is open; nothing runs while it is closed.
 */
export function StationPanel({ world, act, readOnly }: { world: World; act: StationActions; readOnly: boolean }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => () => portHover.set(null), []);
  const wv = world.active;
  const v = wv?.state;
  if (!v || v.eva) return <div className="app-empty">Board a vessel to see its modules.</div>;
  const modules = stationModules(v);
  const control = controlPartUid(v);
  const crewName = new Map(world.crew.map(c => [c.id, c.name]));
  const free = berths(modules);
  const seats = modules.reduce((n, m) => n + m.cabins.reduce((k, c) => k + c.seats, 0), 0);
  const aboard = modules.reduce((n, m) => n + m.cabins.reduce((k, c) => k + c.crew.length, 0), 0);
  const freePorts = modules.reduce((n, m) => n + m.ports.filter(p => p.partner === null).length, 0);
  const moduleOf = new Map<number, string>();
  for (const m of modules) for (const uid of m.partUids) moduleOf.set(uid, m.name);
  const controlName = control === null ? null : v.cache.byUid.get(control)?.def.name;
  const nearby = nearbyVessels(world);
  const toggle = (key: number) => setCollapsed(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="station">
      <div className="st-summary">
        <span><b>{modules.length}</b> module{modules.length === 1 ? '' : 's'}</span>
        <span title="Crew aboard / seats"><b>{aboard}</b>/{seats} crew</span>
        <span title="Free docking ports"><b>{freePorts}</b> free port{freePorts === 1 ? '' : 's'}</span>
        <span>{fmtMass(v.mass)}</span>
      </div>
      <div className="st-control" title="Controls, SAS and the navball are oriented along this part">
        Control from <b>{controlName ? `${controlName} · ${moduleOf.get(control!) ?? ''}` : 'as built'}</b>
      </div>
      {readOnly && <div className="st-note">No command authority: crew moves and control changes are unavailable.</div>}
      {modules.map(m => {
        const open = !collapsed.has(m.key);
        const crewCount = m.cabins.reduce((k, c) => k + c.crew.length, 0);
        const seatCount = m.cabins.reduce((k, c) => k + c.seats, 0);
        return (
          <section key={m.key} className="st-module" aria-label={m.name}>
            <button type="button" className="st-head" aria-expanded={open} onClick={() => toggle(m.key)} {...hoverPorts([{ uid: m.key, tone: 'hover', label: m.name }])}>
              <span className="st-caret">{open ? '▾' : '▸'}</span>
              <span className="st-name">{m.name}</span>
              <span className="st-meta mono">{seatCount > 0 ? `${crewCount}/${seatCount} · ` : ''}{fmtMass(m.mass)}</span>
            </button>
            {open && <div className="st-body">
              {m.cabins.length > 0 && <div className="st-row">
                <span className="st-key">Crew</span>
                <div className="st-list">
                  {m.cabins.flatMap(c => c.crew.map(id => {
                    const dest = free.filter(b => b.uid !== c.uid);
                    return (
                      <div key={id} className="st-crew">
                        <span className="st-person" title={`${crewName.get(id) ?? id} · ${c.name}`}>{crewName.get(id) ?? id}</span>
                        {!readOnly && dest.length > 0 && dest.length <= INLINE_MOVES && dest.map(b => (
                          <button key={b.uid} type="button" className="btn small" title={`Move to ${b.label} (${b.free} free)`} onClick={() => act.transferCrew(id, b.uid)}
                            {...hoverPorts([{ uid: b.uid, tone: 'hover', label: b.label }])}>→ {b.label}</button>
                        ))}
                        {!readOnly && dest.length > INLINE_MOVES && (
                          <select className="st-move" aria-label={`Move ${crewName.get(id) ?? id} to`} value="" onChange={e => e.target.value && act.transferCrew(id, +e.target.value)}>
                            <option value="">Move to…</option>
                            {dest.map(b => <option key={b.uid} value={b.uid}>{b.label} ({b.free} free)</option>)}
                          </select>
                        )}
                        {!readOnly && <button type="button" className="btn small" title="Go on EVA from this module's hatch" onClick={() => act.eva(id)}>EVA</button>}
                      </div>
                    );
                  }))}
                  {m.cabins.every(c => c.crew.length === 0) && <span className="st-dim">Empty · {seatCount} seat{seatCount === 1 ? '' : 's'}</span>}
                </div>
              </div>}
              {m.controls.length > 0 && <div className="st-row">
                <span className="st-key">Control</span>
                <div className="st-list inline">
                  {m.controls.map(c => (
                    <button key={c.uid} type="button" className={`btn small ${control === c.uid ? 'primary' : ''}`} aria-pressed={control === c.uid} disabled={readOnly}
                      title={control === c.uid ? `Controlling from ${c.name}` : `Control from ${c.name}${c.kind === 'port' ? ' (forward = out of the port)' : ''}`}
                      onClick={() => control !== c.uid && act.controlFrom(c.uid)} {...hoverPorts([{ uid: c.uid, tone: 'own', label: c.name }])}>
                      ◎ {c.kind === 'port' ? `Port · ${portSize(m.ports.find(p => p.uid === c.uid)?.size ?? 0)}` : c.name}
                    </button>
                  ))}
                </div>
              </div>}
              {m.ports.length > 0 && <div className="st-row">
                <span className="st-key">Ports</span>
                <div className="st-list">
                  {m.ports.map(p => (
                    <div key={p.uid} className="st-port" {...hoverPorts([{ uid: p.uid, tone: 'hover', label: p.partner === null ? 'Free port' : 'Docked' }])}>
                      <span className={p.partner === null ? 'st-free' : 'st-dim'}>{portSize(p.size)} · {p.partner === null ? 'free' : `↔ ${moduleOf.get(p.partner) ?? 'docked'}`}</span>
                      {p.partner !== null && !readOnly && <button type="button" className="btn small danger" title={`Undock here (${p.name})`} onClick={() => act.undock(p.uid)}>Undock</button>}
                    </div>
                  ))}
                </div>
              </div>}
              {m.resources.length > 0 && <div className="st-row">
                <span className="st-key">Supply</span>
                <div className="st-list">
                  {m.resources.map(r => {
                    const f = r.amount / Math.max(r.max, 1e-9);
                    return (
                      <div key={r.id} className="st-res" title={`${RESOURCES[r.id]?.name ?? r.id}: ${r.amount.toFixed(1)} / ${r.max.toFixed(0)}`}>
                        <span className="st-res-name">{RESOURCES[r.id]?.name ?? r.id}</span>
                        <span className="res-track"><span style={{ width: `${Math.min(100, f * 100)}%`, background: RESOURCE_COLORS[r.id] ?? '#aaa' }} /></span>
                        <span className="mono">{(f * 100).toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>}
            </div>}
          </section>
        );
      })}
      <section className="st-nearby" aria-label="Nearby vessels">
        <div className="label">Nearby · within {formatDistance(SWITCH_RANGE)}</div>
        {nearby.length === 0 && <div className="st-dim">No other vessels nearby.</div>}
        {nearby.map(n => (
          <div key={n.id} className="st-near">
            <span className="st-name" title={n.name}>{n.name}</span>
            <span className="mono st-dim">{formatDistance(n.distance)}</span>
            <button type="button" className={`btn small ${world.targetId === n.id ? 'primary' : ''}`} title={`Target ${n.name}`} onClick={() => act.setTarget(n.id, null)}>Target</button>
            <button type="button" className="btn small" title={`Fly ${n.name}`} onClick={() => act.switchTo(n.id)}>Fly</button>
          </div>
        ))}
      </section>
    </div>
  );
}
