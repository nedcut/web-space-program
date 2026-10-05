import { useMemo, useState } from 'react';
import { useGame } from '../../game/store';
import { partUnlocked } from '../../data/technology';
import { newProgression } from '../../sim/science/progression';
import type { CraftDef } from '../../sim/vessel/types';
import { craftStats } from '../core';
import { CATALOG, DENSITIES, type EditorSession } from '../session';
import { STOCK_CRAFTS } from '../stockCrafts';
import { computeStageStats } from './dv';
import { Icon } from './icons';
import { fmtDv, fmtKg } from './partInfo';

function summary(craft: CraftDef) {
  try {
    const s = craftStats(craft, CATALOG, DENSITIES);
    let dv = 0;
    for (const x of computeStageStats(craft, CATALOG).values()) dv += x.dvVac;
    return `${s.partCount} parts · ${fmtKg(s.totalMass)} · ${s.height.toFixed(1)} m · ${fmtDv(dv)}`;
  } catch {
    return `${craft.parts.length} parts`;
  }
}

export function LoadDialog({ session, onClose }: { session: EditorSession; onClose(): void }) {
  const [rev, setRev] = useState(0);
  const mode = useGame((s) => s.mode);
  const progression = useGame((s) => s.resumeWorld?.progression) ?? newProgression();
  const lockedCount = (c: CraftDef) => new Set(c.parts.map((p) => p.partId).filter((id) => !partUnlocked(id, mode, progression))).size;
  const stock = useMemo(() => STOCK_CRAFTS.map((s) => {
    const craft = s.build();
    return { ...s, craft, info: summary(craft) };
  }), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saved = useMemo(() => session.listSaved().map((c) => ({ craft: c, info: summary(c) })), [rev, session]);

  const load = (c: CraftDef) => {
    session.load(c);
    onClose();
  };

  return (
    <div className="vab-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="vab-modal panel">
        <div className="vab-modal-head">
          <div>
            <div className="label">Craft library</div>
            <div className="vab-modal-title">Load a vehicle</div>
          </div>
          <button className="btn small ghost" onClick={onClose}>Close</button>
        </div>
        <div className="vab-modal-section label">Stock vehicles</div>
        <div className="vab-stock-grid">
          {stock.map((s) => (
            <button key={s.id} className="vab-stock" onClick={() => load(s.craft)}>
              <div className="vab-stock-icon"><Icon name="launch" size={26} /></div>
              <div className="vab-stock-name">{s.name}</div>
              <div className="vab-stock-blurb">{s.blurb}</div>
              <div className="vab-stock-info mono">{s.info}</div>
              {lockedCount(s.craft) > 0 && <div className="vab-stock-locked">Needs research · {lockedCount(s.craft)} locked part type{lockedCount(s.craft) > 1 ? 's' : ''}</div>}
            </button>
          ))}
        </div>
        <div className="vab-modal-section label">Saved vehicles</div>
        <div className="vab-saved">
          {saved.map(({ craft, info }) => (
            <div key={craft.name} className="vab-saved-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="vab-saved-name">{craft.name}</div>
                <div className="vab-saved-info mono">{info}</div>
              </div>
              <button className="btn small" onClick={() => load(craft)}>Load</button>
              <button
                className="btn small danger"
                title="Delete"
                onClick={() => {
                  session.deleteSaved(craft.name);
                  setRev((r) => r + 1);
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
          {!saved.length && <div className="vab-empty">No saved vehicles yet. Use Save (Ctrl+S) to keep your designs.</div>}
        </div>
      </div>
    </div>
  );
}
