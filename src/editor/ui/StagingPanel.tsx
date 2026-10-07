import { usePreflightChecks } from './usePreflightChecks';
import { Panel, Button } from '../../ui/components';
import { useState } from 'react';
import type { EditorSession, SessionView } from '../session';
import { CATALOG } from '../session';
import { getThumbnail } from '../scene/thumbnails';
import { Icon } from './icons';
import { fmtDv } from './partInfo';
import { useThumbnails } from './Palette';

interface Chip { key: string; uids: number[]; partId: string }

/** Stage list: stage 0 fires first and sits at the bottom, like the flight HUD. */
export function StagingPanel({ session, view }: { session: EditorSession; view: SessionView }) {
  useThumbnails();
  const [dragOver, setDragOver] = useState<number | 'new' | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const { checks, busy } = usePreflightChecks(view.craft, view.stageStats.get(0));
  const byUid = new Map(view.craft.parts.map((p) => [p.uid, p]));
  const stages = [...view.stages].reverse();

  const chipsFor = (uids: number[]): Chip[] => {
    const groups = new Map<string, Chip>();
    for (const uid of uids) {
      const p = byUid.get(uid)!;
      const key = p.symmetryGroup !== undefined ? `g${p.symmetryGroup}` : `u${uid}`;
      const g = groups.get(key);
      if (g) g.uids.push(uid);
      else groups.set(key, { key, uids: [uid], partId: p.partId });
    }
    return [...groups.values()];
  };

  const drop = (index: number | 'new', e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    setDragging(null);
    const uid = Number(e.dataTransfer.getData('text/x-wsp-uid'));
    if (!Number.isFinite(uid) || !byUid.has(uid)) return;
    if (index === 'new') {
      const n = view.stages.length;
      session.insertStage(n);
      session.moveToStage(uid, n);
    } else session.moveToStage(uid, index);
    session.removeEmptyStages();
  };

  return (
    <Panel className="vab-staging panel">
      <div className="vab-staging-head">
        <div className="label">Staging</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button className="btn small ghost" title="Add an empty stage at the top" onClick={() => session.insertStage(view.stages.length)}>
            <Icon name="plus" size={15} />
          </Button>
          <Button className="btn small ghost" title="Remove empty stages" onClick={() => session.removeEmptyStages()}>
            <Icon name="trash" size={15} />
          </Button>
          <Button className="btn small ghost" title="Reset to automatic staging" onClick={() => session.autoStage()}>
            <Icon name="wand" size={15} />
          </Button>
        </div>
      </div>
      <details className="preflight-checks" open={checks.length > 0}>
        <summary title="Advisory checks; you can still launch">Pre-flight · {busy ? 'checking…' : checks.length ? `${checks.length} to review` : 'ready'}</summary>
        <div className="preflight-list">{checks.map(c => <div key={c.id}>
          <span>{c.text}</span>{c.uids.length > 0 && <button className="btn small" title="Highlight these parts in the craft" onClick={() => session.select(c.uids)}>Show me</button>}
        </div>)}</div>
      </details>
      <div className="vab-stage-list">
        {dragging !== null && (
          <div
            className={`vab-stage new ${dragOver === 'new' ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver('new'); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => drop('new', e)}
          >
            <Icon name="plus" size={14} /> New stage
          </div>
        )}
        {stages.map((s) => {
          const st = view.stageStats.get(s.index);
          const chips = chipsFor(s.partUids);
          return (
            <div
              key={s.index}
              className={`vab-stage ${dragOver === s.index ? 'over' : ''} ${s.index === 0 ? 'first' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(s.index); }}
              onDragLeave={() => setDragOver((d) => (d === s.index ? null : d))}
              onDrop={(e) => drop(s.index, e)}
            >
              <div className="vab-stage-title">
                <span className="vab-stage-num" title={s.index === 0 ? 'Fires first' : undefined}>{stages.length - 1 - s.index}</span>
                {st && st.dvVac > 0.5 ? (
                  <span className="vab-stage-dv mono" title={`Vacuum ${fmtDv(st.dvVac)} · Sea level ${fmtDv(st.dvAsl)} · burn ${st.burnTime.toFixed(0)} s`}>
                    {fmtDv(s.index === 0 ? st.dvAsl : st.dvVac)}
                    <small>{s.index === 0 ? 'ASL' : 'vac'}</small>
                  </span>
                ) : (
                  <span className="vab-stage-dv dim">{chips.length ? '' : 'empty'}</span>
                )}
              </div>
              {st && st.dvVac > 0.5 && (
                <div className="vab-stage-twr mono">
                  <span className={st.twrAsl < 1 && s.index === 0 ? 'bad' : ''}>TWR {st.twrAsl.toFixed(2)} ASL</span>
                  <span>{st.twrVac.toFixed(2)} vac</span>
                  <span>{st.burnTime.toFixed(0)} s</span>
                </div>
              )}
              <div className="vab-chips">
                {chips.map((c) => {
                  const def = CATALOG.get(c.partId)!;
                  const src = getThumbnail(c.partId);
                  return (
                    <div
                      key={c.key}
                      className={`vab-chip ${c.uids.some(u => view.selectedUids.includes(u)) ? 'selected' : ''} ${view.hoverUid !== null && c.uids.includes(view.hoverUid) ? 'hot' : ''}`}
                      draggable
                      role="button"
                      tabIndex={0}
                      aria-pressed={c.uids.some(u => view.selectedUids.includes(u))}
                      onClick={() => session.select(c.uids, true)}
                      onDoubleClick={() => session.openPanel(c.uids[0])}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); session.select(c.uids, true); } }}
                      title={`${def.name}${c.uids.length > 1 ? ` ×${c.uids.length}` : ''} — click to select, double-click for details, drag to another stage`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/x-wsp-uid', String(c.uids[0]));
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging(c.uids[0]);
                      }}
                      onDragEnd={() => { setDragging(null); setDragOver(null); }}
                      onMouseEnter={() => session.setHighlight(c.uids)}
                      onMouseLeave={() => session.setHighlight([])}
                    >
                      {src ? <img src={src} alt="" draggable={false} /> : <span className="vab-chip-dot" />}
                      <span className="vab-chip-name">{def.name}</span>
                      {c.uids.length > 1 && <span className="vab-chip-count">×{c.uids.length}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!stages.length && <div className="vab-empty">Engines, decouplers and parachutes appear here once attached.</div>}
      </div>
      <div className="vab-staging-foot mono">
        <div><span className="label">Total Δv</span><b>{fmtDv(view.totalDvVac)}</b><small>vac</small></div>
      </div>
    </Panel>
  );
}
