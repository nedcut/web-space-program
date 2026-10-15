import { useMemo } from 'react';
import { Button } from '../../ui/components';
import type { EditorSession, SessionView } from '../session';
import { CATALOG, DENSITIES } from '../session';
import { craftStats } from '../core';
import { getThumbnail } from '../scene/thumbnails';
import { Icon } from './icons';
import { fmtKg } from './partInfo';

/** What each set-aside piece holds, with pick up / edit on the stand / delete. Hovering highlights it in the hall. */
export function SetAsideList({ session, view }: { session: EditorSession; view: SessionView }) {
  const pieces = useMemo(() => view.detached.map((piece) => {
    const groups = new Map<string, number[]>();
    for (const p of piece.parts) if (!p.link) groups.set(p.partId, [...(groups.get(p.partId) ?? []), p.uid]);
    const root = piece.parts.find(p => p.uid === piece.rootUid)!;
    const mass = craftStats({ ...view.craft, parts: piece.parts }, CATALOG, DENSITIES).totalMass;
    return { piece, groups: [...groups], rootName: CATALOG.get(root.partId)?.name ?? root.partId, mass };
  }), [view.detached, view.craft]);
  if (!pieces.length) return null;
  const swapped = view.detached.some(p => p.craft);
  return (
    <details className="vab-setaside" open>
      <summary title="Pieces set aside in the hall are not part of the craft: staging, Δv and pre-flight ignore them.">
        Set aside · {pieces.length === 1 ? '1 piece' : `${pieces.length} pieces`} · won't launch
      </summary>
      <div className="vab-setaside-list">
        {pieces.map(({ piece, groups, rootName, mass }, index) => (
          <div key={`${index}:${piece.rootUid}`} className={`vab-setaside-piece ${piece.craft ? 'craft' : ''}`}
            onMouseEnter={() => session.setHighlight(piece.parts.map(p => p.uid))} onMouseLeave={() => session.setHighlight([])}>
            <div className="vab-setaside-head">
              <span className="vab-setaside-name" title={`Root part: ${rootName}`}>{piece.craft ? view.name : rootName}</span>
              <span className="mono dim">{piece.parts.length} part{piece.parts.length > 1 ? 's' : ''} · {fmtKg(mass)}</span>
            </div>
            <div className="vab-chips">
              {groups.map(([partId, uids]) => {
                const src = getThumbnail(partId);
                return (
                  <button key={partId} type="button" className="vab-chip"
                    title={`${CATALOG.get(partId)?.name ?? partId}: click to pick it up with what hangs from it`}
                    onMouseEnter={() => session.setHighlight(uids)} onMouseLeave={() => session.setHighlight(piece.parts.map(p => p.uid))}
                    onClick={() => { session.setHighlight([]); session.takeFromDetached(index, uids[0]); }}>
                    {src ? <img src={src} alt="" draggable={false} /> : <span className="vab-chip-dot" />}
                    <span className="vab-chip-name">{CATALOG.get(partId)?.name ?? partId}</span>
                    {uids.length > 1 && <span className="vab-chip-count">×{uids.length}</span>}
                  </button>
                );
              })}
            </div>
            <div className="vab-setaside-actions">
              <Button className="btn small" disabled={!!view.held} title="Pick up the whole piece to attach it to the craft"
                onClick={() => { session.setHighlight([]); session.pickUpDetached(index); }}>Pick up</Button>
              <Button className="btn small" disabled={swapped && !piece.craft}
                title={piece.craft ? 'Put your craft back on the stand (this piece is set aside beside it)'
                  : swapped ? 'Swap your craft back onto the stand first' : 'Put this piece on the stand to edit it with every tool; your craft is set aside beside it until you swap it back'}
                onClick={() => { session.setHighlight([]); session.swapDetached(index); }}>{piece.craft ? 'Swap back' : 'Edit on stand'}</Button>
              <Button className="btn small ghost" aria-label="Delete piece" title="Delete this piece (Undo brings it back)"
                onClick={() => { session.setHighlight([]); session.discardDetached(index); }}><Icon name="trash" size={14} /></Button>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
