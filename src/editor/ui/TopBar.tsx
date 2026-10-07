import { Panel, Button } from '../../ui/components';
import { useEffect, useRef, useState } from 'react';
import { encodeCraft, downloadFile, craftFilename } from '../../game/craftSharing';
import { useGame } from '../../game/store';
import { launchCost } from '../../data/technology';
import { PART_CATALOG } from '../../data/parts';
import type { EditorSession, SessionView } from '../session';
import { Icon } from './icons';
import { fmtDv, fmtKg } from './partInfo';

export function TopBar({ session, view, onLoad, onNew, onImport }: { session: EditorSession; view: SessionView; onLoad(): void; onNew(): void; onImport(): void }) {
  const [share, setShare] = useState('');
  const [shareError, setShareError] = useState('');
  // Narrow windows collapse the file, sharing and marker tools into this menu so Launch/Exit always fit.
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const away = (e: PointerEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [more]);
  const item = (label: string, act: () => void, opts: { disabled?: boolean; checked?: boolean } = {}) => (
    <button type="button" className="vab-more-item" role={opts.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={opts.checked} disabled={opts.disabled} onClick={() => { setMore(false); act(); }}>
      {label}{opts.checked !== undefined && <span className="mono">{opts.checked ? 'on' : 'off'}</span>}
    </button>
  );
  async function copy() {
    try { const code = await encodeCraft(session.currentCraft()); setShare(code); setShareError(''); try { await navigator.clipboard.writeText(code); } catch { setShareError('Select the code below and copy it.'); } } catch (e) { setShareError((e as Error).message); }
  }
  const mode = useGame(s => s.mode);
  const funds = useGame(s => s.resumeWorld?.progression?.funds ?? 60000);
  const cost = launchCost(view.craft, PART_CATALOG);
  const s = view.stats;
  return (
    <Panel className="vab-topbar panel">
      <div className="vab-brand vab-mode" role="group" aria-label="Building mode">
        <Button className={`vab-brand-mark ${view.craftType === 'VAB' ? 'on' : ''}`} title="Vehicle Assembly: build vertically, launch from the pad" onClick={() => session.setCraftType('VAB')}>VAB</Button>
        <Button className={`vab-brand-mark ${view.craftType === 'SPH' ? 'on' : ''}`} title="Spaceplane Hangar: build horizontally, launch from the runway" onClick={() => session.setCraftType('SPH')}>SPH</Button>
      </div>
      <input
        className="vab-name"
        value={view.name}
        spellCheck={false}
        maxLength={200}
        onChange={(e) => session.setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        title="Craft name"
      />
      <div className="vab-group vab-sharing vab-collapsible">
        <Button className="btn small" disabled={!view.craft.parts.length} onClick={() => void copy()}>Copy share code</Button>
        <Button className="btn small" onClick={() => downloadFile(craftFilename(view.name), JSON.stringify(session.currentCraft()))}>Export</Button>
        <Button className="btn small" onClick={onImport}>Import</Button>
      </div>
      {(share || shareError) && <Panel className="panel" style={{ position: 'absolute', top: 70, left: '25%', width: '50%', padding: 12, zIndex: 50 }}><p>{shareError || 'Share code copied. Paste it into Import vehicle.'}</p><textarea aria-label="Generated share code" readOnly value={share} onFocus={e => e.target.select()} style={{ width: '100%' }} /><Button className="btn small" onClick={() => { setShare(''); setShareError(''); }}>Close</Button></Panel>}
      <div className="vab-tools">
      <div className="vab-group vab-collapsible">
        <Button className="vab-ibtn" title="New craft" onClick={onNew}><Icon name="new" /></Button>
        <Button className="vab-ibtn" title="Load craft" onClick={onLoad}><Icon name="load" /></Button>
        <Button className="vab-ibtn" title="Save craft (Ctrl+S)" onClick={() => session.save()}><Icon name="save" /></Button>
      </div>
      <div className="vab-group">
        <Button className="vab-ibtn" title="Undo (Ctrl+Z)" disabled={!view.canUndo} onClick={() => session.undo()}><Icon name="undo" /></Button>
        <Button className="vab-ibtn" title="Redo (Ctrl+Y)" disabled={!view.canRedo} onClick={() => session.redo()}><Icon name="redo" /></Button>
      </div>
      <div className="vab-group">
        <Button
          className={`vab-ibtn sym ${view.symmetry > 1 ? 'on' : ''}`}
          title={view.symmetryMode === 'mirror' ? 'Mirror symmetry on/off (X) · R: switch to radial' : 'Radial symmetry (X / Shift+X) · R: switch to mirror'}
          onClick={() => session.cycleSymmetry()}
          onContextMenu={(e) => { e.preventDefault(); session.toggleSymmetryMode(); }}
        >
          {view.symmetryMode === 'mirror' ? <MirrorGlyph on={view.symmetry > 1} /> : <SymGlyph n={view.symmetry} />}
          <span className="mono">{view.symmetryMode === 'mirror' ? (view.symmetry > 1 ? 'mir' : '×1') : `×${view.symmetry}`}</span>
        </Button>
        <Button className="vab-ibtn" title={`Symmetry mode: ${view.symmetryMode} (R)`} onClick={() => session.toggleSymmetryMode()}>
          <span className="mono" style={{ fontSize: 11 }}>{view.symmetryMode === 'mirror' ? 'M' : 'R'}</span>
        </Button>
      </div>
      <div className="vab-group vab-collapsible">
        <Button className={`vab-ibtn ${view.showCoM ? 'on com' : ''}`} title="Show centre of mass" onClick={() => session.toggleCoM()}><Icon name="com" /></Button>
        <Button className={`vab-ibtn ${view.showCoT ? 'on cot' : ''}`} title="Show centre of thrust" onClick={() => session.toggleCoT()}><Icon name="cot" /></Button>
        <Button className={`vab-ibtn ${view.showCoL ? 'on col' : ''}`} title="Show centre of lift" onClick={() => session.toggleCoL()}><LiftGlyph /></Button>
      </div>
      <div className="vab-group">
        <Button className={`vab-ibtn ${view.mode === 'actions' ? 'on' : ''}`} aria-pressed={view.mode === 'actions'} title="Action groups: assign part actions to keys (Abort, Gear, Lights, 1–0…)" onClick={() => session.setMode(view.mode === 'actions' ? 'build' : 'actions')}>
          <Icon name="groups" /><span className="vab-actions-label" style={{ fontSize: 12 }}>Actions</span>
        </Button>
      </div>
      <div className="vab-stats mono">
        <Stat label="Mass" value={fmtKg(s.totalMass)} />
        <Stat label="Parts" value={String(s.partCount)} />
        {view.craftType === 'SPH' ? <Stat label="Length" value={`${s.height.toFixed(1)} m`} /> : <Stat label="Height" value={`${s.height.toFixed(1)} m`} />}
        <Stat label="Δv" value={fmtDv(view.totalDvVac)} accent />
      </div>
      </div>
      <div className="vab-more" ref={moreRef}>
        <Button className={`vab-ibtn ${more ? 'on' : ''}`} title="More tools" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(m => !m)}><Icon name="more" /></Button>
        {more && (
          <div className="vab-more-menu panel" role="menu" aria-label="More tools">
            <div className="vab-more-stats mono">{fmtKg(s.totalMass)} · {s.partCount} parts · {s.height.toFixed(1)} m · <span className="accent">{fmtDv(view.totalDvVac)}</span></div>
            {item('New craft', onNew)}
            {item('Load craft', onLoad)}
            {item('Save craft (Ctrl+S)', () => session.save())}
            <hr />
            {item('Copy share code', () => void copy(), { disabled: !view.craft.parts.length })}
            {item('Export', () => downloadFile(craftFilename(view.name), JSON.stringify(session.currentCraft())))}
            {item('Import', onImport)}
            <hr />
            {item('Centre of mass', () => session.toggleCoM(), { checked: view.showCoM })}
            {item('Centre of thrust', () => session.toggleCoT(), { checked: view.showCoT })}
            {item('Centre of lift', () => session.toggleCoL(), { checked: view.showCoL })}
          </div>
        )}
      </div>
      <Button className="btn primary vab-launch" title={mode === 'career' ? `${cost.toLocaleString()} cr launch cost · ${funds.toLocaleString()} cr available` : undefined} onClick={() => session.launch()}>
        <Icon name="launch" size={17} /> Launch{mode === 'career' && <span className="vab-launch-cost">{cost.toLocaleString()} cr</span>}
      </Button>
      <Button className="vab-ibtn vab-exit" title="Exit to Space Center" aria-label="Exit to Space Center" onClick={() => session.exit()}><Icon name="exit" /></Button>
    </Panel>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="vab-stat">
      <span className="label">{label}</span>
      <span className={accent ? 'accent' : ''}>{value}</span>
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
