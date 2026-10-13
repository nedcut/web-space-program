import { usePreflightChecks } from './usePreflightChecks';
import { Panel, Button } from '../../ui/components';
import { useState } from 'react';
import type { EditorSession, SessionView } from '../session';
import { CATALOG } from '../session';
import { getThumbnail } from '../scene/thumbnails';
import { Icon } from './icons';
import { fmtDv, fmtKg } from './partInfo';
import { useThumbnails } from './Palette';

interface Chip { key: string; uids: number[]; partId: string }
type DragItem = { kind: 'part'; uid: number } | { kind: 'stage'; index: number };
const PART_TYPE = 'text/x-wsp-uid', STAGE_TYPE = 'text/x-wsp-stage';

/** Stage list: stage 0 fires first and sits at the bottom, like the flight HUD. */
export function StagingPanel({ session, view }: { session: EditorSession; view: SessionView }) {
  useThumbnails();
  const [dragOver, setDragOver] = useState<number | 'new' | null>(null);
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const { checks, busy } = usePreflightChecks(view.craft, view.stageStats.get(0));
  const byUid = new Map(view.craft.parts.map((p) => [p.uid, p]));
  const stages = [...view.stages].reverse();
  const hasEngine = view.craft.parts.some(p => CATALOG.get(p.partId)?.modules.some(m => m.type === 'engine'));
  const body = view.dvBodies.find(b => b.id === view.dvBody);
  const [vacuum, setVacuum] = useState(false);
  const airless = !body?.atmosphere || vacuum;

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
    const stage = e.dataTransfer.getData(STAGE_TYPE);
    if (stage !== '') {
      const from = Number(stage);
      if (Number.isInteger(from) && index !== 'new') session.moveStage(from, index);
      return;
    }
    const uid = Number(e.dataTransfer.getData(PART_TYPE));
    if (!Number.isFinite(uid) || !byUid.has(uid)) return;
    if (index === 'new') {
      const n = view.stages.length;
      session.insertStage(n);
      session.moveToStage(uid, n);
    } else session.moveToStage(uid, index);
    session.removeEmptyStages();
  };
  const over = (index: number | 'new') => (e: React.DragEvent) => { e.preventDefault(); setDragOver(index); };

  return (
    <Panel className="vab-staging panel">
      <div className="vab-staging-head">
        <div className="label">Staging{view.manualStaging && <span className="vab-manual" title="You arranged the stages: new parts are inserted into your order. The wand resets to automatic staging.">manual</span>}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button className="btn small ghost" title="Add an empty stage at the top" onClick={() => session.insertStage(view.stages.length)}>
            <Icon name="plus" size={15} />
          </Button>
          <Button className="btn small ghost" title="Remove empty stages" onClick={() => session.removeEmptyStages()}>
            <Icon name="trash" size={15} />
          </Button>
          <Button className={`btn small ghost ${view.manualStaging ? 'on' : ''}`} title="Reset to automatic staging" onClick={() => session.autoStage()}>
            <Icon name="wand" size={15} />
          </Button>
        </div>
      </div>
      {hasEngine && (
        <details className="preflight-checks" open={checks.length > 0}>
          <summary title="Advisory checks; you can still launch">Pre-flight · {busy ? 'checking…' : checks.length ? `${checks.length} to review` : 'ready'}</summary>
          <div className="preflight-list">{checks.map(c => <div key={c.id}>
            <span>{c.text}</span>{c.uids.length > 0 && <button className="btn small" title="Highlight these parts in the craft" onClick={() => session.select(c.uids)}>Show me</button>}
          </div>)}</div>
        </details>
      )}
      {view.detached.length > 0 && (
        <div className="preflight-detached" title="Pieces set aside in the hall are not part of the craft: staging, Δv and pre-flight ignore them. Click one to pick it up and attach it.">
          {view.detached.length === 1 ? '1 set-aside piece' : `${view.detached.length} set-aside pieces`} · won't launch
        </div>
      )}
      <div className="vab-stage-list">
        {dragging?.kind === 'part' && (
          <div className={`vab-stage new ${dragOver === 'new' ? 'over' : ''}`} onDragOver={over('new')} onDragLeave={() => setDragOver(null)} onDrop={(e) => drop('new', e)}>
            <Icon name="plus" size={14} /> New stage
          </div>
        )}
        {stages.map((s) => {
          const st = view.stageStats.get(s.index);
          const chips = chipsFor(s.partUids);
          const first = s.index === 0;
          const powered = !!st && st.dvVac > 0.5;
          // Launch stage reads at the reference body's surface; later stages in vacuum.
          const surface = first && !airless;
          const twr = st ? (surface ? st.twrAsl : st.twrVac) : 0, twrEnd = st ? (surface ? st.twrEndAsl : st.twrEndVac) : 0;
          return (
            <div
              key={s.index}
              className={`vab-stage ${dragOver === s.index ? 'over' : ''} ${first ? 'first' : ''} ${dragging?.kind === 'stage' && dragging.index === s.index ? 'dragging' : ''}`}
              onDragOver={over(s.index)}
              onDragLeave={() => setDragOver((d) => (d === s.index ? null : d))}
              onDrop={(e) => drop(s.index, e)}
            >
              <div
                className="vab-stage-title"
                draggable
                title="Drag to reorder the whole stage"
                onDragStart={(e) => { e.dataTransfer.setData(STAGE_TYPE, String(s.index)); e.dataTransfer.effectAllowed = 'move'; setDragging({ kind: 'stage', index: s.index }); }}
                onDragEnd={() => { setDragging(null); setDragOver(null); }}
              >
                <span className="vab-stage-grip" aria-hidden>⋮⋮</span>
                <span className="vab-stage-num" title={first ? 'Fires first' : undefined}>{stages.length - 1 - s.index}</span>
                {powered ? (
                  <span className="vab-stage-dv mono" title={`Vacuum ${fmtDv(st.dvVac)} · ${body?.name ?? 'Earth'} surface ${fmtDv(st.dvAsl)} · burn ${st.burnTime.toFixed(0)} s`}>
                    {fmtDv(surface ? st.dvAsl : st.dvVac)}
                    <small>{surface ? 'surf' : 'vac'}</small>
                  </span>
                ) : (
                  <span className="vab-stage-dv dim">{chips.length ? '' : 'empty'}</span>
                )}
              </div>
              {powered && (
                <div className="vab-stage-twr mono" title={`Thrust-to-weight at ${body?.name ?? 'Earth'} gravity: ignition → burnout`}>
                  <span className={twr < 1 && first ? 'bad' : ''}>TWR {twr.toFixed(2)}→{twrEnd.toFixed(2)}</span>
                  <span>{st.burnTime.toFixed(0)} s</span>
                </div>
              )}
              {st && (powered || chips.length > 0) && (
                <div className="vab-stage-mass mono" title="Vehicle mass when this stage fires → after its burn">{fmtKg(st.startMass)} → {fmtKg(st.endMass)}</div>
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
                        e.stopPropagation();
                        e.dataTransfer.setData(PART_TYPE, String(c.uids[0]));
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging({ kind: 'part', uid: c.uids[0] });
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
        <label className="vab-dv-body" title="Gravity and surface pressure used for the stage readouts">
          <span className="label" title={body ? `${body.name}: ${body.gravity.toFixed(2)} m/s² surface gravity` : undefined}>Readouts at</span>
          <select value={view.dvBody} onChange={(e) => session.setDvBody(e.target.value)}>
            {view.dvBodies.map(b => <option key={b.id} value={b.id} title={`${b.gravity.toFixed(2)} m/s² surface gravity`}>{b.name}</option>)}
          </select>
          {body?.atmosphere && <span className="vab-dv-vac" title="Read every stage in vacuum (otherwise the first stage reads at the surface)">
            <input type="checkbox" checked={vacuum} onChange={e => setVacuum(e.target.checked)} />vac</span>}
        </label>
        <div><span className="label">Total Δv</span><b>{fmtDv(view.totalDvVac)}</b><small>vac</small></div>
        {!airless && <div className="dim"><span className="label">{body?.name ?? 'Earth'} surface</span><span>{fmtDv(view.totalDvAsl)}</span></div>}
      </div>
    </Panel>
  );
}
