import type { EditorSession, SessionView } from '../session';
import { Icon } from './icons';
import { fmtDv, fmtKg } from './partInfo';

export function TopBar({ session, view, onLoad, onNew }: { session: EditorSession; view: SessionView; onLoad(): void; onNew(): void }) {
  const s = view.stats;
  return (
    <div className="vab-topbar panel">
      <div className="vab-brand vab-mode" role="group" aria-label="Building mode">
        <button className={`vab-brand-mark ${view.craftType === 'VAB' ? 'on' : ''}`} title="Vehicle Assembly: build vertically, launch from the pad" onClick={() => session.setCraftType('VAB')}>VAB</button>
        <button className={`vab-brand-mark ${view.craftType === 'SPH' ? 'on' : ''}`} title="Spaceplane Hangar: build horizontally, launch from the runway" onClick={() => session.setCraftType('SPH')}>SPH</button>
      </div>
      <input
        className="vab-name"
        value={view.name}
        spellCheck={false}
        onChange={(e) => session.setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        title="Craft name"
      />
      <div className="vab-group">
        <button className="vab-ibtn" title="New craft" onClick={onNew}><Icon name="new" /></button>
        <button className="vab-ibtn" title="Load craft" onClick={onLoad}><Icon name="load" /></button>
        <button className="vab-ibtn" title="Save craft (Ctrl+S)" onClick={() => session.save()}><Icon name="save" /></button>
      </div>
      <div className="vab-group">
        <button className="vab-ibtn" title="Undo (Ctrl+Z)" disabled={!view.canUndo} onClick={() => session.undo()}><Icon name="undo" /></button>
        <button className="vab-ibtn" title="Redo (Ctrl+Y)" disabled={!view.canRedo} onClick={() => session.redo()}><Icon name="redo" /></button>
      </div>
      <div className="vab-group">
        <button
          className={`vab-ibtn sym ${view.symmetry > 1 ? 'on' : ''}`}
          title={view.symmetryMode === 'mirror' ? 'Mirror symmetry on/off (X) · R: switch to radial' : 'Radial symmetry (X / Shift+X) · R: switch to mirror'}
          onClick={() => session.cycleSymmetry()}
          onContextMenu={(e) => { e.preventDefault(); session.toggleSymmetryMode(); }}
        >
          {view.symmetryMode === 'mirror' ? <MirrorGlyph on={view.symmetry > 1} /> : <SymGlyph n={view.symmetry} />}
          <span className="mono">{view.symmetryMode === 'mirror' ? (view.symmetry > 1 ? 'mir' : '×1') : `×${view.symmetry}`}</span>
        </button>
        <button className="vab-ibtn" title={`Symmetry mode: ${view.symmetryMode} (R)`} onClick={() => session.toggleSymmetryMode()}>
          <span className="mono" style={{ fontSize: 11 }}>{view.symmetryMode === 'mirror' ? 'M' : 'R'}</span>
        </button>
        <button className={`vab-ibtn ${view.showCoM ? 'on com' : ''}`} title="Show centre of mass" onClick={() => session.toggleCoM()}><Icon name="com" /></button>
        <button className={`vab-ibtn ${view.showCoT ? 'on cot' : ''}`} title="Show centre of thrust" onClick={() => session.toggleCoT()}><Icon name="cot" /></button>
        <button className={`vab-ibtn ${view.showCoL ? 'on col' : ''}`} title="Show centre of lift" onClick={() => session.toggleCoL()}><LiftGlyph /></button>
      </div>
      <div className="vab-stats mono">
        <Stat label="Mass" value={fmtKg(s.totalMass)} />
        <Stat label="Parts" value={String(s.partCount)} />
        {view.craftType === 'SPH' ? <Stat label="Length" value={`${s.height.toFixed(1)} m`} /> : <Stat label="Height" value={`${s.height.toFixed(1)} m`} />}
        <Stat label="Δv" value={fmtDv(view.totalDvVac)} accent />
      </div>
      <div style={{ flex: 1 }} />
      <button className="btn primary vab-launch" onClick={() => session.launch()}>
        <Icon name="launch" size={17} /> Launch
      </button>
      <button className="vab-ibtn" title="Exit to Space Center" onClick={() => session.exit()}><Icon name="exit" /></button>
    </div>
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
