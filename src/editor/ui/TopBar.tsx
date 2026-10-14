import { Button, Modal } from '../../ui/components';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { encodeCraft, downloadFile, craftFilename } from '../../game/craftSharing';
import { useGame } from '../../game/store';
import { launchCost } from '../../data/technology';
import { PART_CATALOG } from '../../data/parts';
import { bindingLabel, type Action } from '../../input/bindings';
import type { EditorSession, SessionView } from '../session';
import { IS_MAC } from '../scene/EditorView';
import { Icon } from './icons';
import { fmtDv, fmtKg } from './partInfo';
import { CRAFT_TYPE_LABELS } from '../craftTypeLabels';
import { useEscape } from '../../ui/nav/escape';
import { FacilityUnblock, useFacilityBlock } from '../../ui/hub/FacilityUpgrade';

/** Current key label for an editor action (Ctrl shown as ⌘ on macOS). */
export function keyOf(action: Action) {
  const label = bindingLabel(action);
  return IS_MAC ? label.replace(/Ctrl\+/g, '⌘').replace(/Backspace/g, '⌫') : label;
}

export function TopBar({ session, view, onLoad, onNew, onImport, onFrame }: { session: EditorSession; view: SessionView; onLoad(): void; onNew(): void; onImport(): void; onFrame(): void }) {
  const [share, setShare] = useState<{ code: string; error: string } | null>(null);
  // Narrow windows collapse the file and overlay groups into this menu so Launch always fits.
  const [menu, setMenu] = useState<null | { id: 'more' | 'share'; left: number }>(null);
  const bar = useRef<HTMLDivElement>(null);
  const tip = useToolbarTips(bar);
  useEscape(() => setMenu(null), !!menu, 'panel');
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.vab-menu, [data-menu]')) setMenu(null); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [menu]);
  // Menus are positioned against the bar, outside the clipping tool row.
  const openMenu = (id: 'more' | 'share', button: HTMLElement) => {
    if (menu?.id === id) return setMenu(null);
    const r = button.getBoundingClientRect(), b = bar.current!.getBoundingClientRect();
    setMenu({ id, left: Math.max(0, Math.min(r.left - b.left, b.width - 240)) });
  };
  const item = (label: string, act: () => void, opts: { disabled?: boolean; checked?: boolean; keys?: string } = {}) => (
    <button type="button" className="vab-more-item" role={opts.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={opts.checked} disabled={opts.disabled} onClick={() => { setMenu(null); act(); }}>
      {label}{opts.checked !== undefined ? <span className="mono">{opts.checked ? 'on' : 'off'}</span> : opts.keys && <kbd className="kbd">{opts.keys}</kbd>}
    </button>
  );
  async function copy() {
    try {
      const code = await encodeCraft(session.currentCraft());
      try { await navigator.clipboard.writeText(code); setShare({ code, error: '' }); } catch { setShare({ code, error: 'Select the code below and copy it.' }); }
    } catch (e) { setShare({ code: '', error: (e as Error).message }); }
  }
  const exportFile = () => downloadFile(craftFilename(view.name), JSON.stringify(session.currentCraft()));
  const shareItems = <>
    {item('Copy share code', () => void copy(), { disabled: !view.craft.parts.length })}
    {item('Export file', exportFile, { disabled: !view.craft.parts.length })}
    {item('Import…', onImport)}
  </>;
  const mode = useGame(s => s.mode);
  const funds = useGame(s => s.resumeWorld?.progression?.funds ?? 60000);
  const cost = launchCost(view.craft, PART_CATALOG);
  const block = useFacilityBlock(view.craft);
  const s = view.stats;
  const save = keyOf('editorSave');
  return (
    <div className="vab-topbar panel" ref={bar} onPointerOver={tip.over} onPointerOut={tip.out} onFocus={tip.over} onBlur={tip.out} onPointerDown={tip.hide}>
      <Button className="btn ghost small vab-exit" aria-label="Exit to Space Center" data-tip="Back to the Space Center · your craft stays loaded here" onClick={() => session.exit()}>
        <Icon name="arrow" size={14} /><span className="vab-exit-label">Space Center</span>
      </Button>
      <div className="vab-brand vab-mode" role="group" aria-label="Building mode">
        {(['VAB', 'SPH'] as const).map(type => (
          <Button key={type} className={`vab-brand-mark ${view.craftType === type ? 'on' : ''}`} aria-pressed={view.craftType === type} data-tip={`${CRAFT_TYPE_LABELS[type].long}: ${CRAFT_TYPE_LABELS[type].hint}`} onClick={() => session.setCraftType(type)}>{CRAFT_TYPE_LABELS[type].short}</Button>
        ))}
      </div>
      <label className={`vab-name-wrap ${view.dirty ? 'dirty' : ''}`} data-tip={view.dirty ? `Unsaved changes · ${save} saves to the library` : 'Craft name · saved'}>
        <input
          className="vab-name"
          aria-label="Craft name"
          value={view.name}
          spellCheck={false}
          maxLength={200}
          onChange={(e) => session.setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="vab-dirty" aria-live="polite">{view.dirty ? <><span className="vab-dirty-dot" aria-hidden /><span className="vab-dirty-text">Unsaved</span></> : null}</span>
      </label>
      <div className="vab-tools">
        <Group label="File" className="vab-collapsible">
          <Button className="vab-ibtn" aria-label="New craft" data-tip="New craft" onClick={onNew}><Icon name="new" /></Button>
          <Button className="vab-ibtn" aria-label="Open craft library" data-tip="Open craft library · stock and saved vehicles" onClick={onLoad}><Icon name="load" /></Button>
          <Button className={`vab-ibtn ${view.dirty ? 'pending' : ''}`} aria-label="Save craft" data-tip={view.dirty ? 'Save craft · unsaved changes' : 'Save craft'} data-keys={save} onClick={() => session.save()}><Icon name="save" /></Button>
          <Button className={`vab-ibtn vab-share-btn ${menu?.id === 'share' ? 'on' : ''}`} data-menu aria-haspopup="menu" aria-expanded={menu?.id === 'share'} data-tip="Share: copy a share code, export or import a craft file" onClick={e => openMenu('share', e.currentTarget)}>
            Share <span aria-hidden className="vab-caret">▾</span>
          </Button>
        </Group>
        <Group label="Edit">
          <Button className="vab-ibtn" aria-label="Undo" data-tip="Undo" data-keys={keyOf('editorUndo')} disabled={!view.canUndo} onClick={() => session.undo()}><Icon name="undo" /></Button>
          <Button className="vab-ibtn" aria-label="Redo" data-tip="Redo" data-keys={keyOf('editorRedo')} disabled={!view.canRedo} onClick={() => session.redo()}><Icon name="redo" /></Button>
        </Group>
        <Group label="Tools">
          {TOOLS.map(t => (
            <Button key={t.id} className={`vab-ibtn ${view.tool === t.id ? 'on' : ''}`} aria-pressed={view.tool === t.id} aria-label={t.label} data-tip={`${t.label}: ${t.help}`} data-keys={keyOf(t.action)} onClick={() => session.setTool(t.id)}>
              <ToolGlyph tool={t.id} />
            </Button>
          ))}
          <Button className={`vab-ibtn snap ${view.angleSnap ? 'on' : ''}`} aria-pressed={view.angleSnap} aria-label="Snap" data-tip={`Snap offsets to 5 cm and angles to 15° (hold Shift for 1 cm / 5°) · ${view.angleSnap ? 'on' : 'off'}`} data-keys={keyOf('editorAngleSnap')} onClick={() => session.toggleAngleSnap()}>
            <SnapGlyph on={view.angleSnap} />
          </Button>
        </Group>
        <Group label="Symmetry">
          <Button
            className={`vab-ibtn sym ${view.symmetry > 1 ? 'on' : ''}`}
            aria-label="Symmetry count"
            data-tip={view.symmetryMode === 'mirror' ? 'Mirror symmetry on/off · right-click: switch to radial' : 'Radial symmetry count (Shift: fewer) · right-click: switch to mirror'}
            data-keys={keyOf('editorSymmetry')}
            onClick={() => session.cycleSymmetry()}
            onContextMenu={(e) => { e.preventDefault(); session.toggleSymmetryMode(); }}
          >
            {view.symmetryMode === 'mirror' ? <MirrorGlyph on={view.symmetry > 1} /> : <SymGlyph n={view.symmetry} />}
            <span className="mono">{view.symmetryMode === 'mirror' ? (view.symmetry > 1 ? 'mir' : '×1') : `×${view.symmetry}`}</span>
          </Button>
          <Button className="vab-ibtn vab-symmode" aria-label={`Symmetry mode: ${view.symmetryMode}`} data-tip={`Symmetry mode: ${view.symmetryMode === 'mirror' ? 'mirror (across the craft)' : 'radial (around the long axis)'} · click to switch`} data-keys={keyOf('editorSymmetryMode')} onClick={() => session.toggleSymmetryMode()}>
            <span className="mono">{view.symmetryMode === 'mirror' ? 'Mirror' : 'Radial'}</span>
          </Button>
        </Group>
        <Group label="Overlays" className="vab-collapsible">
          <Button className={`vab-ibtn ${view.showCoM ? 'on com' : ''}`} aria-pressed={view.showCoM} aria-label="Centre of mass" data-tip="Show centre of mass" onClick={() => session.toggleCoM()}><Icon name="com" /></Button>
          <Button className={`vab-ibtn ${view.showCoT ? 'on cot' : ''}`} aria-pressed={view.showCoT} aria-label="Centre of thrust" data-tip="Show centre of thrust" onClick={() => session.toggleCoT()}><Icon name="cot" /></Button>
          <Button className={`vab-ibtn ${view.showCoL ? 'on col' : ''}`} aria-pressed={view.showCoL} aria-label="Centre of lift" data-tip="Show centre of lift" onClick={() => session.toggleCoL()}><LiftGlyph /></Button>
          <Button className="vab-ibtn" aria-label="Frame craft" data-tip="Zoom to fit the craft and any set-aside pieces" data-keys={keyOf('editorFrame')} onClick={onFrame}><FrameGlyph /></Button>
        </Group>
        <Group label="Mode">
          <Button className={`vab-ibtn ${view.mode === 'actions' ? 'on' : ''}`} aria-pressed={view.mode === 'actions'} aria-label="Action groups" data-tip="Action groups: assign part actions to keys (Abort, Gear, Lights, 1–0…)" onClick={() => session.setMode(view.mode === 'actions' ? 'build' : 'actions')}>
            <Icon name="groups" /><span className="vab-actions-label">Actions</span>
          </Button>
        </Group>
        <div className="vab-stats mono">
          {/* Δv first: narrower windows drop Parts, then Height (media rules count children). */}
          <Stat label="Δv" value={fmtDv(view.totalDvVac)} accent />
          <Stat label="Mass" value={fmtKg(s.totalMass)} over={block?.facility === 'pad' ? block.reason : undefined} />
          <Stat label="Parts" value={String(s.partCount)} over={block?.facility === 'hall' ? block.reason : undefined} />
          {view.craftType === 'SPH' ? <Stat label="Length" value={`${s.height.toFixed(1)} m`} /> : <Stat label="Height" value={`${s.height.toFixed(1)} m`} />}
        </div>
      </div>
      <div className="vab-more">
        <Button className={`vab-ibtn ${menu?.id === 'more' ? 'on' : ''} ${view.dirty ? 'pending' : ''}`} data-menu aria-label="More tools" data-tip={view.dirty ? 'File, sharing and overlays · unsaved changes' : 'File, sharing and overlays'} aria-haspopup="menu" aria-expanded={menu?.id === 'more'} onClick={e => openMenu('more', e.currentTarget)}><Icon name="more" /></Button>
      </div>
      {block && <FacilityUnblock block={block} compact className="btn small warn vab-unblock" />}
      <Button className={`btn primary vab-launch${block ? ' blocked' : ''}`} data-tip={block ? block.message : mode === 'career' ? `${cost.toLocaleString()} cr launch cost · ${funds.toLocaleString()} cr available` : 'Roll out to the launch site'} onClick={() => session.launch()}>
        <Icon name="launch" size={17} /> Launch{mode === 'career' && <span className="vab-launch-cost">{cost.toLocaleString()} cr</span>}
      </Button>
      {menu?.id === 'share' && <div className="vab-menu vab-more-menu panel" role="menu" aria-label="Share" style={{ left: menu.left }}>{shareItems}</div>}
      {menu?.id === 'more' && (
        <div className="vab-menu vab-more-menu panel right" role="menu" aria-label="More tools">
          <div className="vab-more-stats mono">{fmtKg(s.totalMass)} · {s.partCount} parts · {s.height.toFixed(1)} m · <span className="accent">{fmtDv(view.totalDvVac)}</span></div>
          {item('New craft', onNew)}
          {item('Open craft library', onLoad)}
          {item('Save craft', () => session.save(), { keys: save })}
          <hr />
          {shareItems}
          <hr />
          {item('Centre of mass', () => session.toggleCoM(), { checked: view.showCoM })}
          {item('Centre of thrust', () => session.toggleCoT(), { checked: view.showCoT })}
          {item('Centre of lift', () => session.toggleCoL(), { checked: view.showCoL })}
          {item('Frame craft', onFrame, { keys: keyOf('editorFrame') })}
        </div>
      )}
      <div ref={tip.el} className="vab-tip" role="tooltip" hidden />
      {share && (
        <Modal title="Share code" onClose={() => setShare(null)} className="ui-modal-small vab-share-modal">
          <p className="ui-modal-body">{share.error || 'Copied to the clipboard. Anyone can paste it into Share → Import… to load this vehicle.'}</p>
          {share.code && <textarea className="vab-share-code mono" aria-label="Generated share code" readOnly rows={4} value={share.code} data-autofocus onFocus={e => e.target.select()} />}
          <div className="ui-modal-actions"><Button className="btn primary" onClick={() => setShare(null)}>Done</Button></div>
        </Modal>
      )}
    </div>
  );
}

/** A captioned toolbar group: KSP veterans scan for words, not just icons. */
function Group({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={`vab-gwrap ${className}`} role="group" aria-label={label}>
    <span className="vab-glabel" aria-hidden>{label}</span>
    <div className="vab-group">{children}</div>
  </div>;
}

/**
 * One shared tooltip for the bar: shows `data-tip` plus the live key binding (`data-keys`) below the hovered or
 * focused control. Positioned imperatively (no React state), only on pointer/focus events.
 */
function useToolbarTips(bar: React.RefObject<HTMLDivElement | null>) {
  const el = useRef<HTMLDivElement>(null);
  const state = useRef<{ target: HTMLElement | null; timer: number }>({ target: null, timer: 0 });
  const show = (target: HTMLElement) => {
    const tip = el.current, host = bar.current;
    if (!tip || !host || !target.isConnected) return;
    tip.replaceChildren(target.dataset.tip ?? '');
    if (target.dataset.keys) { const k = document.createElement('kbd'); k.className = 'kbd'; k.textContent = target.dataset.keys; tip.append(k); }
    tip.hidden = false;
    const r = target.getBoundingClientRect(), b = host.getBoundingClientRect();
    const x = Math.max(4, Math.min(r.left - b.left + r.width / 2 - tip.offsetWidth / 2, b.width - tip.offsetWidth - 4));
    tip.style.transform = `translate(${Math.round(x)}px, 0)`;
  };
  const hide = () => { clearTimeout(state.current.timer); state.current.target = null; if (el.current) el.current.hidden = true; };
  return {
    el,
    /** Clicking dismisses the tip until the pointer moves to another control (it would cover menus). */
    hide() { clearTimeout(state.current.timer); if (el.current) el.current.hidden = true; },
    over(e: React.SyntheticEvent) {
      const target = (e.target as Element).closest?.<HTMLElement>('[data-tip]');
      if (!target || target === state.current.target) return;
      // Mouse clicks focus buttons too: only keyboard focus shows a tip.
      if (e.type === 'focus' && !target.matches(':focus-visible')) return;
      clearTimeout(state.current.timer);
      state.current.target = target;
      // Hover waits a moment (no flicker while crossing the bar); focus and moves between tips are immediate.
      if (e.type === 'focus' || (el.current && !el.current.hidden)) show(target);
      else state.current.timer = window.setTimeout(() => show(target), 350);
    },
    out(e: React.SyntheticEvent) {
      const next = (e as React.PointerEvent).relatedTarget as Element | null;
      if (next && state.current.target?.contains(next)) return;
      if (e.type === 'pointerout' && next?.closest?.('[data-tip]')) return; // `over` switches directly
      hide();
    },
  };
}

const TOOLS = [
  { id: 'place', action: 'editorToolPlace', label: 'Place', help: 'pick up and attach parts; Alt/Option-click copies' },
  { id: 'offset', action: 'editorToolOffset', label: 'Offset', help: 'click a part, drag its arrows (or the part) to move it' },
  { id: 'rotate', action: 'editorToolRotate', label: 'Rotate', help: 'click a part, drag its rings to turn it' },
  { id: 'reroot', action: 'editorToolReroot', label: 'Re-root', help: 'click a part to make it the root' },
] as const;

function ToolGlyph({ tool }: { tool: (typeof TOOLS)[number]['id'] }) {
  const paths: Record<typeof tool, React.ReactNode> = {
    place: <path d="M6 3l12 7-5 1.5L16 19l-2.5 1-3-7.5L6 16z" />,
    offset: <path d="M12 3v18M3 12h18M12 3l-3 3m3-3 3 3M12 21l-3-3m3 3 3-3M3 12l3-3m-3 3 3 3M21 12l-3-3m3 3-3 3" />,
    rotate: <><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M17 3v4.5h-4.5" /></>,
    reroot: <><circle cx="12" cy="6" r="2.5" /><path d="M12 8.5V14m0 0-5 6m5-6 5 6M5 20h4m6 0h4" /></>,
  };
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{paths[tool]}</svg>;
}

function SnapGlyph({ on }: { on: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
      <path d="M4 20h16M4 20V4" />
      <path d="M4 20 17 7" strokeDasharray={on ? undefined : '2 2'} />
      <path d="M10 20a6 6 0 0 0-1.8-4.2" />
    </svg>
  );
}

function Stat({ label, value, accent, over }: { label: string; value: string; accent?: boolean; over?: string }) {
  return (
    <div className="vab-stat" data-tip={over}>
      <span className="label">{label}</span>
      <span className={over ? 'over' : accent ? 'accent' : ''}>{value}</span>
    </div>
  );
}

function MirrorGlyph({ on }: { on: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2 2" />
      <path d="M9 7 L4 12 L9 17 Z" fill={on ? 'currentColor' : 'none'} />
      <path d="M15 7 L20 12 L15 17 Z" fill={on ? 'currentColor' : 'none'} />
    </svg>
  );
}

function FrameGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15" />
      <path d="M12 7.5 L14 12 L12 16.5 L10 12 Z" />
    </svg>
  );
}

function LiftGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="15" r="4" />
      <path d="M12 11 V3 M8.5 6.5 L12 3 L15.5 6.5" />
    </svg>
  );
}

function SymGlyph({ n }: { n: number }) {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [12 + Math.cos(a) * 7, 12 + Math.sin(a) * 7];
  });
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <circle cx="12" cy="12" r="3" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.8" fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}
