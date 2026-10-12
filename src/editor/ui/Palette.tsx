import { Button, Panel } from '../../ui/components';
import { useGame } from '../../game/store';
import { partUnlocked } from '../../data/technology';
import { newProgression } from '../../sim/science/progression';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PART_DEFS } from '../../data/parts';
import type { PartCategory, PartDef } from '../../sim/vessel/types';
import { CATALOG, type EditorSession, type SessionView } from '../session';
import { deleteSubassembly, listSubassemblies, saveSubassembly, subscribeSubassemblies, type SavedSubassembly } from '../subassemblies';
import type { Subassembly } from '../core';
import { getThumbnail, requestThumbnails, subscribeThumbnails, thumbnailVersion } from '../scene/thumbnails';
import { Icon } from './icons';
import { isTyping } from '../../input/bindings';
import { CATEGORY_TABS, RESOURCE_SHORT, fmtKN, fmtKg, sizeLabel, wetMass } from './partInfo';

export function useThumbnails() {
  return useSyncExternalStore(subscribeThumbnails, thumbnailVersion);
}

export function Palette({ session, view }: { session: EditorSession; view: SessionView }) {
  const mode = useGame(s => s.mode);
  const saved = useGame(s => s.resumeWorld);
  const available = useMemo(() => PART_DEFS.filter(p => partUnlocked(p.id, mode, saved?.progression ?? newProgression())), [mode, saved]);
  const [tab, setTab] = useState<PartCategory | 'all' | 'subassemblies'>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const observer = useRef<IntersectionObserver | null>(null);
  const observed = useRef(new Map<Element, PartDef>());
  const watch = useCallback((el: HTMLElement, def: PartDef) => {
    if (getThumbnail(def.id) !== undefined) return () => {};
    if (!observer.current) observer.current = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const part = observed.current.get(entry.target);
        if (part) requestThumbnails([part]);
        observed.current.delete(entry.target);
        observer.current?.unobserve(entry.target);
      }
    }, { root: el.closest('.vab-cards'), rootMargin: '160px' });
    observed.current.set(el, def); observer.current.observe(el);
    return () => { observed.current.delete(el); observer.current?.unobserve(el); };
  }, []);
  useEffect(() => {
    const entries = observed.current;
    return () => { observer.current?.disconnect(); entries.clear(); };
  }, []);
  const [hover, setHover] = useState<{ def: PartDef; y: number } | null>(null);
  // "/" jumps to the part search from anywhere in the hall (not while typing or with a dialog open).
  const search = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      focusSearch.current = true;
      setTab(t => (t === 'subassemblies' ? 'all' : t));
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (focusSearch.current && tab !== 'subassemblies') { focusSearch.current = false; search.current?.focus(); } }, [tab]);
  const heldAtDown = useRef(false);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of available) c.set(d.category, (c.get(d.category) ?? 0) + 1);
    return c;
  }, [available]);

  const parts = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return available.filter((d) => (tab === 'all' || d.category === tab) && (!q || `${d.name} ${d.manufacturer} ${d.description} ${d.category}`.toLowerCase().includes(q)));
  }, [tab, deferredQuery, available]);

  const enter = useCallback((def: PartDef, y: number) => setHover({ def, y }), []);
  const leave = useCallback((def: PartDef) => setHover(h => h?.def === def ? null : h), []);
  const pick = useCallback((id: string) => { if (!heldAtDown.current) session.pickNew(id); }, [session]);

  const holding = !!view.held;
  const saving = tab === 'subassemblies' && view.held?.kind === 'assembly';

  return (
    <div
      className={`vab-palette panel ${holding ? (saving ? 'save' : 'discard') : ''}`}
      onPointerDownCapture={() => (heldAtDown.current = !!session.getSnapshot().held)}
      onPointerUp={() => {
        if (!heldAtDown.current) return;
        if (saving) { storeSubassembly(session, session.subassemblyFrom()); session.cancelHeld(); }
        else session.deleteHeld();
      }}
    >
      <div className="vab-tabs">
        {CATEGORY_TABS.filter((t) => t.id === 'all' || counts.get(t.id)).map((t) => (
          <Button key={t.id} className={`vab-tab ${tab === t.id ? 'on' : ''}`} title={t.label} onClick={() => setTab(t.id)}>
            <Icon name={t.id} size={19} />
          </Button>
        ))}
        <Button className={`vab-tab ${tab === 'subassemblies' ? 'on' : ''}`} title="Subassemblies: saved part groups" onClick={() => setTab('subassemblies')}>
          <SubassemblyGlyph />
        </Button>
      </div>
      {tab === 'subassemblies' ? <SubassemblyDrawer session={session} view={view} /> : <div className="vab-palette-main">
        <div className="vab-palette-head">
          <div className="label">{CATEGORY_TABS.find((t) => t.id === tab)?.label}</div>
          <label className="vab-search">
            <Icon name="search" size={15} />
            <input ref={search} value={query} aria-label="Search parts" placeholder="Search parts" onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { if (query) setQuery(''); else e.currentTarget.blur(); } }} />
            {!query && <kbd className="kbd vab-search-key" title="Press / to search parts">/</kbd>}
          </label>
        </div>
        <div className="vab-cards" aria-busy={query !== deferredQuery}>
          {parts.map(d => <PartCard key={d.id} def={d} selected={view.held?.kind === 'new' && view.held.partId === d.id} enter={enter} leave={leave} pick={pick} watch={watch} />)}
          {!parts.length && <div className="vab-empty">No parts match “{query}”.</div>}
        </div>
      </div>}
      {holding && (
        <div className="vab-discard">
          {saving ? <SubassemblyGlyph size={28} /> : <Icon name="trash" size={28} />}
          <div>{saving ? 'Drop here to save as a subassembly' : 'Drop here to discard'}</div>
        </div>
      )}
      {hover && !holding && <PartTooltip def={hover.def} y={hover.y} />}
    </div>
  );
}

function SubassemblyGlyph({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
      <path d="M9 3h6v5H9zM5 11h6v5H5zM13 11h6v5h-6zM8 19h8v2H8z" />
      <path d="M12 8v3M8 16v3m8-3v3" />
    </svg>
  );
}

function subassemblyName(sub: Subassembly): string {
  const root = sub.parts.find(p => p.uid === sub.rootUid);
  const base = `${CATALOG.get(root?.partId ?? '')?.name ?? 'Assembly'}${sub.parts.length > 1 ? ` +${sub.parts.length - 1}` : ''}`;
  const taken = new Set(listSubassemblies(CATALOG).map(s => s.name));
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} (${i})`;
  return name;
}

function storeSubassembly(session: EditorSession, sub: Subassembly | null, name?: string) {
  if (!sub) return session.toast('Pick up an assembly or select a part first', 'warn');
  try {
    const saved = saveSubassembly(name ?? subassemblyName(sub), sub, CATALOG);
    session.toast(`Saved subassembly “${saved.name}”`, 'good');
  } catch {
    session.toast('Could not save the subassembly: browser storage is full or unavailable', 'bad');
  }
}

/** Saved part groups: click to hold one, drop a held assembly on the drawer (or use Save) to add one. */
function SubassemblyDrawer({ session, view }: { session: EditorSession; view: SessionView }) {
  const list = useSyncExternalStore(subscribeSubassemblies, () => listSubassemblies(CATALOG));
  const [renaming, setRenaming] = useState<string | null>(null);
  const selected = view.selectedUids.length ? view.craft.parts.find(p => p.uid === view.selectedUids[0]) : undefined;
  return (
    <div className="vab-palette-main vab-subs">
      <div className="vab-palette-head">
        <div className="label">Subassemblies</div>
        <Button className="btn small" disabled={!selected} title={selected ? 'Save the selected part and everything attached below it' : 'Select a part (offset tool, staging list or right-click) to save it with its attachments'}
          onClick={() => storeSubassembly(session, session.subassemblyFrom(selected?.uid))}>
          Save {selected ? `“${CATALOG.get(selected.partId)?.name}”` : 'selection'}
        </Button>
      </div>
      <div className="vab-sub-list">
        {list.map((s: SavedSubassembly) => (
          <div key={s.id} className="vab-sub">
            {renaming === s.id ? (
              <input autoFocus defaultValue={s.name} maxLength={80} className="vab-sub-rename"
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== s.name) { saveSubassembly(name, s, CATALOG); deleteSubassembly(s.id, CATALOG); } setRenaming(null); }} />
            ) : (
              <button type="button" className="vab-sub-pick" title="Pick up this subassembly" onClick={() => session.pickSubassembly(s)} onDoubleClick={() => setRenaming(s.id)}>
                <span className="vab-sub-name">{s.name}</span>
                <span className="vab-sub-meta mono">{s.parts.length} part{s.parts.length === 1 ? '' : 's'}</span>
              </button>
            )}
            <button type="button" className="vab-sub-btn" title="Rename" onClick={() => setRenaming(s.id)}>✎</button>
            <button type="button" className="vab-sub-btn" title="Delete subassembly" onClick={() => deleteSubassembly(s.id, CATALOG)}>×</button>
          </div>
        ))}
        {!list.length && <div className="vab-empty">Pick up part of your craft and drop it here, or select a part and press Save. Saved groups keep their symmetry, settings and fuel, and work in every craft.</div>}
      </div>
    </div>
  );
}

/** Cards subscribe to their own image and request only the viewport plus a small scrolling margin. */
const PartCard = memo(function PartCard({ def, selected, enter, leave, pick, watch }: {
  def: PartDef; selected: boolean; watch: (el: HTMLElement, def: PartDef) => () => void; enter: (def: PartDef, y: number) => void; leave: (def: PartDef) => void; pick: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const src = useSyncExternalStore(subscribeThumbnails, () => getThumbnail(def.id));
  useEffect(() => {
    return watch(host.current!, def);
  }, [def, watch]);
  return <div ref={host} className="vab-card-slot">
    <Button className={`vab-card ${selected ? 'on' : ''}`}
      onMouseEnter={e => enter(def, e.currentTarget.getBoundingClientRect().top)} onMouseLeave={() => leave(def)} onClick={() => pick(def.id)}>
      <div className="vab-thumb">{src ? <img src={src} alt="" draggable={false} /> : <div className="vab-thumb-wait" />}</div>
      <div className="vab-card-name">{def.name}</div>
    </Button>
  </div>;
});

function PartTooltip({ def, y }: { def: PartDef; y: number }) {
  const engine = def.modules.find((m) => m.type === 'engine');
  const cmd = def.modules.find((m) => m.type === 'command');
  const dec = def.modules.find((m) => m.type === 'decoupler');
  const chute = def.modules.find((m) => m.type === 'parachute');
  const wing = def.modules.find((m) => m.type === 'liftingSurface');
  const wheel = def.modules.find((m) => m.type === 'reactionWheel');
  const source = def.modules.find(m => m.type === 'generator' || m.type === 'fuelCell');
  const solar = def.modules.find((m) => m.type === 'solarPanel');
  const rows: [string, string][] = [];
  const wet = wetMass(def);
  rows.push(['Mass', wet > def.dryMass + 0.5 ? `${fmtKg(wet)} (dry ${fmtKg(def.dryMass)})` : fmtKg(def.dryMass)]);
  rows.push(['Cost', `${def.cost.toLocaleString('en-US')} cr`]);
  rows.push(['Size', sizeLabel(def)]);
  if (engine && engine.type === 'engine') {
    rows.push(['Thrust', `${fmtKN(engine.maxThrustVac)} vac · ${fmtKN((engine.maxThrustVac * engine.ispAsl) / engine.ispVac)} ASL`]);
    rows.push(['Isp', `${engine.ispVac} s vac · ${engine.ispAsl} s ASL`]);
    rows.push(['Twr (part)', ((engine.maxThrustVac / (wet * 9.81))).toFixed(1)]);
    if (engine.gimbalRange) rows.push(['Gimbal', `±${((engine.gimbalRange * 180) / Math.PI).toFixed(1)}°`]);
    rows.push(['Throttle', engine.throttleable ? `${Math.round(engine.minThrottle * 100)}–100%` : 'Fixed (solid)']);
  }
  if (cmd && cmd.type === 'command') rows.push(['Crew', cmd.crew ? `${cmd.crew} seat${cmd.crew > 1 ? 's' : ''}` : 'Uncrewed probe']);
  if (cmd?.controllable === false) rows.push(['Control', 'Requires cockpit or probe']);
  if (source?.type === 'generator' || source?.type === 'fuelCell') rows.push(['Power', `${source.chargeRate} EC/s${source.type === 'fuelCell' ? ' · fuel + oxidizer' : ' · constant'}`]);
  if (wheel && wheel.type === 'reactionWheel') rows.push(['Torque', `${(wheel.torque / 1000).toFixed(1)} kN·m`]);
  if (dec && dec.type === 'decoupler') rows.push(['Ejection', `${dec.ejectionImpulse} N·s${dec.radial ? ' (radial)' : ''}`]);
  if (chute && chute.type === 'parachute') rows.push(['Drag area', `${chute.deployedCdA} m²`]);
  if (wing && wing.type === 'liftingSurface') rows.push(['Wing area', `${wing.area} m²${wing.deflection ? ' · control' : ''}`]);
  if (solar && solar.type === 'solarPanel') rows.push(['Charge', `${solar.chargeRate} EC/s`]);
  for (const [k, v] of Object.entries(def.resources)) if (v) rows.push([RESOURCE_SHORT[k as keyof typeof RESOURCE_SHORT], `${Math.round(v).toLocaleString('en-US')} u`]);
  rows.push(['Attach', [def.attachNodes.some((n) => n.id !== 'srf') ? 'stack' : '', def.surfaceAttachable ? 'surface' : ''].filter(Boolean).join(' + ') || '—']);
  const top = Math.max(64, Math.min(y - 20, window.innerHeight - 380));
  return (
    <Panel className="vab-tooltip panel" style={{ top }}>
      <div className="vab-tt-name">{def.name}</div>
      <div className="vab-tt-mfr">{def.manufacturer}</div>
      <div className="vab-tt-desc">{def.description}</div>
      <table className="vab-tt-table mono">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
