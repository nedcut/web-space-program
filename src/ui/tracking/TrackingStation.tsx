import { Button, ConfirmModal, PromptModal } from '../components';
import { Icon } from '../components/Icon';
import { bodyBreadcrumbs } from '../../render/map/presentation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { game, updateSettings, useGame } from '../../game/store';
import { World, type WorldVessel } from '../../game/world';
import { Universe } from '../../game/universe';
import { deserializeWorld } from '../../game/persistence';
import { leaveTracking, persistTracking, type TrackingExit } from './leave';
import { PART_CATALOG } from '../../data/parts';
import { RAILS_WARP, warpRate } from '../../game/timewarp';
import type { Body } from '../../sim/bodies/types';
import { formatDate, formatDistance, formatDuration } from '../format';
import { TrackingView, type TrackingFocus } from './trackingView';
import { MapContextMenu } from '../map/MapContextMenu';
import { mapContextActions, type MapActionId, type MapObject } from '../map/mapActions';
import { useEscape } from '../nav/escape';
import { facilities } from '../nav/scenes';
import {
  classifyParts, cleanVesselName, earliestEvent, filterFleet, groupFleet, kindCounts, listKey, sortFleet,
  GROUP_LABEL, KIND_LABEL, KIND_ORDER, MAX_VESSEL_NAME, SORT_LABEL,
  type FleetEntry, type FleetEvent, type FleetGrouping, type FleetSort, type VesselKind,
} from './fleet';
import { loadTrackingPrefs, saveTrackingPrefs, type TrackingPrefs } from './prefs';
import { KindIcon } from './KindIcon';
import '../nav/nav.css';
import './tracking.css';
import { MapLayers } from '../map/MapLayers';
import { biomeObjectives } from '../../game/biomeObjectives';

const distance = (n: number) => Number.isFinite(n) ? formatDistance(n) : '∞';
const rowId = (id: string) => `trk-row-${id}`;

/** Kind is derived from parts; cache it per vessel until its part count changes (staging, docking). */
const kindCache = new WeakMap<WorldVessel['state'], { n: number; landed: boolean; kind: VesselKind }>();
function vesselKind(v: WorldVessel): VesselKind {
  const landed = v.mode === 'prelaunch' || v.state.situation !== 'flying';
  const hit = kindCache.get(v.state);
  if (hit && hit.n === v.state.parts.length && hit.landed === landed) return hit.kind;
  const kind = classifyParts(v.state.parts, { eva: !!v.state.eva, landed });
  kindCache.set(v.state, { n: v.state.parts.length, landed, kind });
  return kind;
}

const RAILS_LABEL: Record<string, (to: string, from: string) => string> = {
  soiEnter: (to) => `Enters ${to} SOI`,
  soiExit: (_, from) => `Leaves ${from} SOI`,
  impact: () => 'Impact',
  atmosphere: () => 'Atmosphere entry',
};

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
  const search = useRef<HTMLInputElement>(null);
  const view = useRef<TrackingView | null>(null);
  const [, refresh] = useState(0);
  const [focus, setFocus] = useState<TrackingFocus>({ kind: 'body', id: world.universe.sunId });
  const [terminate, setTerminate] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ obj: MapObject; x: number; y: number } | null>(null);
  const [prefs, setPrefsState] = useState(loadTrackingPrefs);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(() => world.activeId ?? world.vessels.keys().next().value ?? null);
  const setPrefs = (p: Partial<TrackingPrefs>) => setPrefsState(prev => { const next = { ...prev, ...p }; saveTrackingPrefs(next); return next; });
  const update = () => refresh((n) => n + 1);
  useEffect(() => {
    const renderer = new TrackingView(host.current!, world, update, setFocus, (pick, at) => setMenu(pick && at ? { obj: pick, x: at.x, y: at.y } : null));
    view.current = renderer;
    // Start on the player's fleet rather than a whole-solar-system view.
    const first = (world.activeId && world.vessels.get(world.activeId)) || world.vessels.values().next().value;
    if (first) renderer.setFocus({ kind: 'vessel', id: first.state.id });
    // Keyboard users land in the list: ↑↓ / Enter work straight away.
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.tracking-row[tabindex="0"]')?.focus({ preventScroll: true }));
    return () => {
      renderer.dispose();
      view.current = null;
      persistTracking(world);
    };
  }, [world]);
  // Focusing a vessel from the map (double-click, context menu) selects it in the list too.
  useEffect(() => { if (focus.kind === 'vessel') setSelected(focus.id); }, [focus]);
  // "/" jumps to the search box from anywhere on the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable || t.closest('dialog'))) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const exit = (scene: TrackingExit) => leaveTracking(world, scene);
  useEscape(() => exit('spaceCenter'), true, 'screen');
  const remove = (id: string) => {
    const vessel = world.vessels.get(id);
    if (vessel) world.finishFlight(vessel, 'lost');
    world.vessels.delete(id);
    if (world.activeId === id) { world.activeId = null; world.nodes = []; }
    if (focus.kind === 'vessel' && focus.id === id) view.current?.setFocus({ kind: 'body', id: world.universe.sunId });
    update();
  };
  const fly = (id: string) => { if (!world.vessels.has(id)) return; if (world.activeId !== id) world.nodes = []; world.activeId = id; exit('flight'); };
  const menuName = (o: MapObject) => o.kind === 'vessel' ? world.vessels.get(o.id)?.state.name ?? o.id : world.universe.bodies.get(o.id)?.name ?? o.id;
  const runMenu = (id: MapActionId, obj: MapObject) => {
    setMenu(null);
    if (id === 'switch') fly(obj.id);
    else view.current?.setFocus(obj);
  };

  // Solar-system tree order (Sun, Mercury, Venus, Earth, Moon, …) for body groups.
  const bodyRank = useMemo(() => {
    const rank = new Map<string, number>();
    const walk = (id: string) => { rank.set(id, rank.size); for (const c of world.universe.body(id).children) walk(c); };
    walk(world.universe.sunId);
    return (id: string) => rank.get(id) ?? rank.size;
  }, [world]);

  // List model: rebuilt on the 4 Hz UI refresh (never per frame). One orbit summary per flying vessel.
  const ut = world.ut;
  const alarmsByVessel = new Map<string, FleetEvent[]>();
  for (const a of world.alarmClock.alarms) {
    if (a.fired || a.disabled) continue;
    const list = alarmsByVessel.get(a.vesselId) ?? [];
    // Automatic node alarms ring 30 s early (game/alarms.ts); the list shows the burn itself.
    list.push(a.kind === 'node' ? { label: 'Maneuver', time: a.time + 30 } : { label: a.label, time: a.time });
    alarmsByVessel.set(a.vesselId, list);
  }
  const entries: FleetEntry[] = [];
  const apsides = new Map<string, string>();
  let order = 0;
  for (const v of world.vessels.values()) {
    const b = world.universe.body(v.body);
    let status: string;
    if (v.mode === 'prelaunch') status = 'Prelaunch';
    else if (v.state.situation === 'landed') status = 'Landed';
    else if (v.state.situation === 'splashed') status = 'Splashed down';
    else {
      status = 'Flying';
      try {
        const o = world.orbitSummary(v);
        status = o.orbit.e >= 1 ? 'Escaping' : o.pe < (b.atmosphere?.height ?? 0) ? 'Sub-orbital' : 'Orbiting';
        apsides.set(v.state.id, `Ap ${o.orbit.e < 1 ? distance(o.ap) : 'escape'} · Pe ${distance(o.pe)}`);
      } catch { /* degenerate orbit */ }
    }
    if (v.state.eva) status = `EVA · ${status.toLowerCase()}`;
    const re = v.railsEvent;
    const railsNext = re && RAILS_LABEL[re.reason] ? { label: RAILS_LABEL[re.reason](world.universe.bodies.get(re.nextBody ?? '')?.name ?? '', b.name), time: re.time } : null;
    const nodeNext = world.activeId === v.state.id && world.nodes.length ? { label: 'Maneuver', time: Math.min(...world.nodes.map(n => n.time)) } : null;
    entries.push({
      id: v.state.id, kind: vesselKind(v), name: v.state.name, body: v.body, bodyName: b.name, status, order: order++,
      next: earliestEvent(ut, [nodeNext, railsNext, ...(alarmsByVessel.get(v.state.id) ?? [])]),
      active: world.activeId === v.state.id,
      crew: v.state.parts.reduce((n, p) => n + (p.crew?.length ?? 0), 0),
    });
  }
  for (const f of world.flags) {
    const who = world.crew.find(c => c.id === f.astronautId)?.name;
    entries.push({ id: `flag:${f.id}`, kind: 'flag', name: who ? `Flag · ${who}` : 'Flag', body: f.body, bodyName: world.universe.body(f.body).name, status: `Planted ${formatDate(f.plantedAt)}`, order: order++ });
  }
  const counts = kindCounts(entries);
  const hidden = new Set(prefs.hidden);
  const shown = sortFleet(filterFleet(entries, { query, hidden }), prefs.sort);
  const groups = groupFleet(shown, prefs.group, bodyRank);
  const flat = groups.flatMap(g => g.entries);
  const selIndex = flat.findIndex(e => e.id === selected);
  const byId = (id: string) => entries.find(e => e.id === id);

  const focusEntry = (e: FleetEntry) => {
    if (e.kind === 'flag') view.current?.setFocus({ kind: 'body', id: e.body });
    else view.current?.setFocus({ kind: 'vessel', id: e.id });
  };
  const select = (e: FleetEntry, moveFocus: boolean) => {
    setSelected(e.id);
    if (moveFocus) {
      const el = document.getElementById(rowId(e.id));
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'nearest' });
    }
  };
  const act = (e: FleetEntry, action: 'fly' | 'focus' | 'rename' | 'terminate') => {
    if (action === 'focus') focusEntry(e);
    else if (e.kind === 'flag') return;
    else if (action === 'fly') fly(e.id);
    else if (action === 'rename') setRename(e.id);
    else setTerminate(e.id);
  };
  const onListKey = (ev: ReactKeyboardEvent<HTMLElement>) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const onRow = (ev.target as HTMLElement).getAttribute('role') === 'option';
    const r = listKey(ev.key, selIndex, flat.length);
    if (!r) return;
    if ('index' in r) { ev.preventDefault(); select(flat[r.index], true); return; }
    // Enter/F/F2/Delete belong to the row; on a button inside the list they keep their own meaning.
    if (!onRow || selIndex < 0) return;
    ev.preventDefault();
    act(flat[selIndex], r.action);
  };
  const onSearchKey = (ev: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!flat.length) return;
    if (ev.key === 'ArrowDown' || ev.key === 'Enter') {
      ev.preventDefault();
      const e = ev.key === 'Enter' || selIndex < 0 ? flat[0] : flat[selIndex];
      select(e, true);
      if (ev.key === 'Enter') focusEntry(e);
    }
  };
  const toggleKind = (k: VesselKind) => setPrefs({ hidden: hidden.has(k) ? prefs.hidden.filter(x => x !== k) : [...prefs.hidden, k] });

  const body = focus.kind === 'body' ? world.universe.body(focus.id) : world.universe.body(world.vessels.get(focus.id)?.body ?? world.universe.sunId);
  const tree = (b: Body) => <div key={b.id}>
    {b.children.length ? <details open={b.kind === 'star' || bodyBreadcrumbs(body, world.universe.bodies).some(parent => parent.id === b.id)}><summary><Button className="btn ghost small" onClick={() => view.current?.setFocus({ kind: 'body', id: b.id })}>{b.name}</Button></summary><div className="tracking-children">{b.children.map((id) => tree(world.universe.body(id)))}</div></details>
      : <Button className="btn ghost small" onClick={() => view.current?.setFocus({ kind: 'body', id: b.id })}>{b.name}</Button>}
  </div>;

  const renameVessel = rename ? world.vessels.get(rename) : undefined;
  const terminateVessel = terminate ? world.vessels.get(terminate) : undefined;
  const actions = (e: FleetEntry) => {
    const v = world.vessels.get(e.id);
    const recoverable = v && v.body === 'earth' && (v.mode === 'prelaunch' || v.state.situation === 'landed' || v.state.situation === 'splashed');
    return <div className="tracking-actions">
      <Button className="btn small" onClick={() => focusEntry(e)} title="Focus the view (F)">Focus</Button>
      {v && <Button className="btn small primary" onClick={() => fly(e.id)} title="Take control (Enter)">Fly</Button>}
      {v && <Button className="btn small" onClick={() => setRename(e.id)} title="Rename (F2)">Rename</Button>}
      {recoverable && <Button className="btn small" onClick={() => { if (world.recoverVessel(e.id)) { if (focus.kind === 'vessel' && focus.id === e.id) view.current?.setFocus({ kind: 'body', id: 'earth' }); update(); exit('flightlog'); } }}>Recover</Button>}
      {v && <Button className="btn small danger" onClick={() => setTerminate(e.id)} title="Terminate (Delete)">Terminate</Button>}
    </div>;
  };
  const vesselCount = entries.filter(e => e.kind !== 'flag').length;

  return <div className="fullscreen tracking-station">
    <div className="fullscreen" ref={host} />
    <div className="overlay">
      <header className="panel tracking-header">
        <Button className="btn ghost small scene-back" onClick={() => exit('spaceCenter')} aria-keyshortcuts="Escape">
          <Icon name="arrow" size={14} /> Space Center <span className="kbd">Esc</span>
        </Button>
        <h1 className="tracking-title">Fleet Tracking</h1>
        <div className="tracking-clock"><span className="mono">{formatDate(world.ut)}</span>
          <label className="label">Warp <select aria-label="Time warp" value={world.warp.index} onChange={(e) => { world.warp = { mode: 'rails', index: Number(e.target.value) }; update(); }}>{RAILS_WARP.map((r, i) => <option key={r} value={i}>{r.toLocaleString()}×</option>)}</select></label>
          <span className="mono tracking-rate" title="Actual rate (limited by the active vessel)">{warpRate(world.warp).toLocaleString()}×</span>
        </div>
        <nav className="scene-switcher tracking-switcher" aria-label="Space Center facilities">
          {facilities(world.mode).map(f => <Button key={f.scene} className={`btn ghost small ${f.scene === 'tracking' ? 'on' : ''}`}
            title={f.label} aria-current={f.scene === 'tracking' ? 'page' : undefined} onClick={() => f.scene !== 'tracking' && exit(f.scene)}>
            <Icon name={f.icon} size={14} />{f.label}
          </Button>)}
          <Button className="btn ghost small" onClick={() => void import('../Spacepedia').then(m => { exit('pedia'); m.openPedia('tracking'); })}><Icon name="book" size={14} />Spacepedia</Button>
        </nav>
      </header>
      <aside className="panel tracking-fleet" aria-label="Fleet">
        <div className="tracking-fleet-head">
          <div className="label">Vessels · {vesselCount}{shown.length !== entries.length && <span className="tracking-muted"> · showing {shown.length}</span>}</div>
          <label className="tracking-search"><Icon name="search" size={14} /><input ref={search} type="search" placeholder="Search name, body, type" aria-label="Search vessels" aria-keyshortcuts="/" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onSearchKey} /><span className="kbd">/</span></label>
          {counts.size > 0 && <div className="tracking-chips" role="group" aria-label="Show vessel types">
            {KIND_ORDER.filter(k => counts.has(k)).map(k => <button key={k} className={`tracking-chip ${hidden.has(k) ? '' : 'on'}`} aria-pressed={!hidden.has(k)} title={`${hidden.has(k) ? 'Show' : 'Hide'} ${KIND_LABEL[k].many.toLowerCase()}`} onClick={() => toggleKind(k)}>
              <KindIcon kind={k} size={13} />{KIND_LABEL[k].many}<span>{counts.get(k)}</span>
            </button>)}
          </div>}
          <div className="tracking-view-opts">
            <label className="label">Group <select value={prefs.group} onChange={e => setPrefs({ group: e.target.value as FleetGrouping })}>{(Object.keys(GROUP_LABEL) as FleetGrouping[]).map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select></label>
            <label className="label">Sort <select value={prefs.sort} onChange={e => setPrefs({ sort: e.target.value as FleetSort })}>{(Object.keys(SORT_LABEL) as FleetSort[]).map(s => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}</select></label>
          </div>
        </div>
        <div className="tracking-list" role="listbox" aria-label="Vessels" onKeyDown={onListKey}>
          {!entries.length && <p className="tracking-muted">No vessels to track yet. Launch a vehicle from the Space Center to begin a mission.</p>}
          {!!entries.length && !flat.length && <p className="tracking-muted">Nothing matches. {query ? 'Clear the search' : 'Turn on a type above'} to see more.</p>}
          {groups.map(g => <section key={g.key} role="group" aria-label={g.label}>
            {prefs.group !== 'none' && <h3 className="label tracking-group">{prefs.group === 'type' && <KindIcon kind={g.key as VesselKind} size={13} />}{g.label}<span>{g.entries.length}</span></h3>}
            {g.entries.map((e, i) => {
              const sel = e.id === selected;
              const tab = sel || (selIndex < 0 && g === groups[0] && i === 0);
              return <div key={e.id} className={`tracking-item ${sel ? 'selected' : ''}`}>
                <div id={rowId(e.id)} role="option" aria-selected={sel} tabIndex={tab ? 0 : -1} className="tracking-row"
                  onClick={() => { select(e, false); focusEntry(e); }} onDoubleClick={() => act(e, 'fly')}>
                  <span className={`tracking-kind kind-${e.kind}`} title={KIND_LABEL[e.kind].one}><KindIcon kind={e.kind} /></span>
                  <div className="tracking-row-main">
                    <div className="tracking-row-name"><strong>{e.name}</strong>{e.active && <span className="tracking-badge">Active</span>}</div>
                    <div className="tracking-muted">{e.status}{prefs.group !== 'body' && ` · ${e.bodyName}`}{!!e.crew && ` · ${e.crew} crew`}</div>
                    {sel && apsides.has(e.id) && <div className="mono tracking-apsides">{apsides.get(e.id)}</div>}
                    {e.next && <div className="mono tracking-next" title={formatDate(e.next.time)}>{e.next.label} · T−{formatDuration(e.next.time - ut)}</div>}
                  </div>
                </div>
                {sel && actions(e)}
              </div>;
            })}
          </section>)}
        </div>
        <div className="tracking-keys tracking-muted"><span className="kbd">↑</span><span className="kbd">↓</span> select · <span className="kbd">Enter</span> fly · <span className="kbd">F</span> focus · <span className="kbd">F2</span> rename</div>
      </aside>
      <aside className="tracking-right">
        <section className="panel tracking-overlays"><div className="label">Map overlays</div>
          <label className="label"><input type="checkbox" checked={overlay} onChange={e => updateSettings({ commsOverlay: e.target.checked })} /> Signal links · red weak / green strong</label>
          <label className="label"><input type="checkbox" checked={world.showLagrangePoints} onChange={e => { world.showLagrangePoints = e.target.checked; update(); }} /> Lagrange points</label>
          {view.current && <MapLayers map={view.current.mapView} bodyId={body.id} bodyName={id => world.universe.bodies.get(id)?.name ?? id}
            objectives={() => biomeObjectives(world.progression)} onShow={(b, biome) => view.current?.showBiome(b, biome)} />}
        </section>
        <details className="panel tracking-bodies" open><summary className="label">Celestial bodies</summary>{tree(world.universe.body(world.universe.sunId))}</details>
        <section className="panel tracking-info"><div className="label">{focus.kind === 'vessel' ? 'Reference body' : 'Focused body'} · {world.universe.preset} scale</div><nav aria-label="Focus path" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>{bodyBreadcrumbs(body, world.universe.bodies).map((b,i) => <span key={b.id}>{i > 0 && ' › '}<Button className="btn ghost small" aria-current={b.id === body.id ? 'location' : undefined} onClick={() => view.current?.setFocus({ kind: 'body', id: b.id })}>{b.name}</Button></span>)}</nav><h2>{body.name}</h2><p className="tracking-muted">{body.description ?? 'No description available.'}</p><dl>
          {Object.entries({ Radius: distance(body.radius), 'Surface gravity': `${body.surfaceGravity.toFixed(2)} m/s²`, 'Sphere of influence': distance(body.soi), 'Atmosphere height': body.atmosphere ? distance(body.atmosphere.height) : 'None', 'Surface pressure': `${((body.atmosphere?.surfacePressure ?? 0) / 1000).toFixed(2)} kPa`, 'Orbital period': body.orbitalPeriod ? formatDuration(body.orbitalPeriod) : '—', Rotation: `${formatDuration(Math.abs(body.rotationPeriod))}${body.rotationPeriod < 0 ? ' (retrograde)' : ''}`, Moons: body.children.filter((id) => world.universe.body(id).kind === 'moon').length }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl></section>
      </aside>
      {menu && <MapContextMenu x={menu.x} y={menu.y} title={menuName(menu.obj)} subtitle={menu.obj.kind === 'vessel' ? KIND_LABEL[byId(menu.obj.id)?.kind ?? 'probe'].one : undefined}
        actions={mapContextActions(menu.obj, { canSwitch: true, name: menuName, info: false })}
        onAction={id => runMenu(id, menu.obj)} onClose={() => setMenu(null)} />}
      <footer className="panel tracking-help">Drag to orbit · Scroll to zoom · Double-click to focus · Click or right-click for actions · Warp is limited by the active vessel’s altitude and encounter safety.</footer>
      {renameVessel && <PromptModal title="Rename vessel" label={`New name (up to ${MAX_VESSEL_NAME} characters)`} initial={renameVessel.state.name} submitLabel="Rename"
        onSubmit={name => { const clean = cleanVesselName(name); if (clean) renameVessel.state.name = clean; setRename(null); update(); requestAnimationFrame(() => document.getElementById(rowId(renameVessel.state.id))?.focus({ preventScroll: true })); }}
        onCancel={() => setRename(null)} />}
      {terminateVessel && <ConfirmModal title="Terminate vessel?" danger confirmLabel="Terminate" onCancel={() => setTerminate(null)} onConfirm={() => { remove(terminateVessel.state.id); setTerminate(null); }}>
        <p>{terminateVessel.state.name} will be permanently removed from this world.</p>
      </ConfirmModal>}
    </div>
  </div>;
}
