import { memo, useState } from 'react';
import { bindingLabel } from '../../input/bindings';
import { formatSpeed } from '../../ui/format';
import { snapshotEqual } from '../../util/snapshotEqual';
import { AppIcon, StagePartIcon } from './glyphs';
import type { HudStage } from './Hud';

interface Tile { key: string; uids: number[]; name: string; icon: HudStage['parts'][number]['icon']; active: boolean; fuelFrac?: number; heatFrac?: number }

/** Identical parts of one stage share a tile with a count (radial boosters, chute pairs). */
function tiles(stage: HudStage): Tile[] {
  const out = new Map<string, Tile>();
  for (const p of stage.parts) {
    const key = `${p.name}|${p.icon}|${p.active}`;
    const t = out.get(key);
    if (!t) out.set(key, { key, uids: [p.uid], name: p.name, icon: p.icon, active: p.active, fuelFrac: p.fuelFrac, heatFrac: p.heatFrac });
    else {
      t.uids.push(p.uid);
      if (p.fuelFrac !== undefined) t.fuelFrac = Math.min(t.fuelFrac ?? 1, p.fuelFrac);
      if (p.heatFrac !== undefined) t.heatFrac = Math.max(t.heatFrac ?? 0, p.heatFrac);
    }
  }
  return [...out.values()];
}

export interface StagingProps {
  stages: HudStage[];
  stage: number;
  locked: boolean;
  imperial: boolean;
  canStage: boolean;
  dockingMode: boolean;
  stageProgress?: number;
  cb: { onStage(): void; onStageLock(): void; onSelectPart(uid: number): void; onHoverPart(uids: number[] | null): void; onToggleDocking(): void };
}

/** Bottom-left staging stack: the next stage at the bottom, each stage's parts as icons with fuel/heat gauges. */
export const StagingStack = memo(function StagingStack({ stages, stage, locked, imperial, canStage, dockingMode, stageProgress, cb }: StagingProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const speed = (v: number) => (imperial ? `${(v * 2.236936).toFixed(0)} mph` : formatSpeed(v));
  const total = stages.reduce((s, x) => s + x.deltaV, 0);
  const toggle = (i: number) => setCollapsed(c => { const n = new Set(c); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <div className={`stg ${locked ? 'locked' : ''}`} data-tutorial="staging">
      <div className="stg-controls">
        <button type="button" className="stg-go" disabled={!canStage || locked} onClick={cb.onStage}
          title={locked ? `Staging locked (${bindingLabel('stageLock')})` : `Activate the next stage (${bindingLabel('stage')})`}>
          <AppIcon name="stage" size={15} />
          <span>Stage</span>
          <span className="kbd">{bindingLabel('stage')}</span>
          {!!stageProgress && <span className="stg-progress" style={{ width: `${stageProgress * 100}%` }} />}
        </button>
        <button type="button" className={`stg-icon-btn ${locked ? 'on warn' : ''}`} aria-pressed={locked} onClick={cb.onStageLock}
          title={`${locked ? 'Unlock' : 'Lock'} staging (${bindingLabel('stageLock')})`}>
          <AppIcon name={locked ? 'lock' : 'unlock'} size={15} />
        </button>
        <button type="button" className={`stg-icon-btn ${dockingMode ? 'on' : ''}`} aria-pressed={dockingMode} data-tutorial="docking" onClick={cb.onToggleDocking}
          title="Docking mode: port alignment indicator and target-relative speed">
          <AppIcon name="docking" size={15} />
        </button>
      </div>
      <div className="stg-scroll">
        {stages.map(s => {
          const current = s.index === stage;
          const active = s.parts.some(p => p.active);
          const closed = collapsed.has(s.index);
          return (
            <section key={s.index} className={`stg-group ${current ? 'current' : ''} ${active ? 'active' : ''}`} aria-label={`Stage ${s.index}`}>
              <button type="button" className="stg-head" onClick={() => toggle(s.index)} aria-expanded={!closed}
                title={active ? 'Burning now' : current ? `Fires on the next ${bindingLabel('stage')}` : `Stage ${s.index} · click to ${closed ? 'expand' : 'collapse'}`}>
                <span className="stg-num">{s.index}</span>
                <span className="stg-tag">{active ? 'ACTIVE' : current ? 'NEXT' : ''}</span>
                {closed && <span className="stg-count">{s.parts.length}</span>}
              </button>
              {s.deltaV > 0.05 && <span className="stg-dv mono" title="Stage Δv at current pressure">{speed(s.deltaV)}</span>}
              {!closed && (
                <div className="stg-parts">
                  {tiles(s).map(tile => (
                    <button key={tile.key} type="button" className={`stg-part ${tile.active ? 'on' : ''} ${tile.heatFrac && tile.heatFrac > 0.9 ? 'hot' : ''}`}
                      aria-label={tile.name}
                      title={`${tile.name}${tile.uids.length > 1 ? ` ×${tile.uids.length}` : ''}${tile.fuelFrac !== undefined ? ` · fuel ${Math.round(tile.fuelFrac * 100)}%` : ''}${tile.heatFrac !== undefined ? ` · heat ${Math.round(tile.heatFrac * 100)}%` : ''}\nClick: highlight and open part details`}
                      onClick={() => cb.onSelectPart(tile.uids[0])}
                      onPointerEnter={() => cb.onHoverPart(tile.uids)} onPointerLeave={() => cb.onHoverPart(null)}>
                      <StagePartIcon icon={tile.icon} size={20} />
                      {tile.fuelFrac !== undefined && <span className="stg-fuel" style={{ height: `${tile.fuelFrac * 100}%` }} />}
                      {tile.heatFrac !== undefined && <span className="stg-heat" style={{ width: `${Math.min(1, tile.heatFrac) * 100}%` }} />}
                      {tile.uids.length > 1 && <span className="stg-mult">{tile.uids.length}</span>}
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {stages.length > 0 && <div className="stg-total"><span className="label">Total Δv</span> <span className="mono">{speed(total)}</span></div>}
      </div>
    </div>
  );
}, (a, b) => a.stage === b.stage && a.locked === b.locked && a.imperial === b.imperial && a.canStage === b.canStage && a.dockingMode === b.dockingMode
  && a.stageProgress === b.stageProgress && a.cb === b.cb && snapshotEqual(a.stages, b.stages));
