import { localId } from '../../util/localId';
import { listLibrary, saveLibraryItem, craftRepository, type LibraryCraft } from '../../game/saves';
import { CraftThumbnail } from './CraftThumbnail';
import { useEffect, useMemo, useState } from 'react';
import { game, useGame } from '../../game/store';
import { Universe } from '../../game/universe';
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
    for (const x of computeStageStats(craft, CATALOG, new Universe(game.get().scalePreset).body('earth')).values()) dv += x.dvVac;
    return `${s.partCount} parts · ${fmtKg(s.totalMass)} · ${s.height.toFixed(1)} m · ${fmtDv(dv)}`;
  } catch {
    return `${craft.parts.length} parts`;
  }
}

export function LoadDialog({ session, onClose }: { session: EditorSession; onClose(): void }) {
  const [rev, setRev] = useState(0);
  const scale = useGame(s => s.scalePreset);
  const mode = useGame((s) => s.mode);
  const progression = useGame((s) => s.resumeWorld?.progression) ?? newProgression();
  const lockedCount = (c: CraftDef) => new Set(c.parts.map((p) => p.partId).filter((id) => !partUnlocked(id, mode, progression))).size;
  const stock = useMemo(() => STOCK_CRAFTS.map((s) => {
    const craft = s.build();
    return { ...s, craft, info: summary(craft) };
  }), []);
  const [saved, setSaved] = useState<LibraryCraft[]>([]);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { let live = true; void listLibrary().then(items => { if (live) setSaved(items); }).catch(e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [rev]);
  const refresh = (action: Promise<unknown>) => void action.then(() => setRev(r => r + 1)).catch(e => setError((e as Error).message));
  function edit(item: LibraryCraft, field: 'name' | 'folder' | 'tags') {
    const value = window.prompt(`Vehicle ${field}`, field === 'name' ? item.craft.name : field === 'folder' ? item.folder : item.tags.join(', '));
    if (value === null || (field === 'name' && !value.trim())) return;
    if (field === 'name' && saved.some(x => x.id !== item.id && x.craft.name === value.trim())) { setError('That vehicle name is already used.'); return; }
    refresh(saveLibraryItem({ ...item, updatedAt: Date.now(), craft: field === 'name' ? { ...item.craft, name: value.trim().slice(0, 200) } : item.craft, folder: field === 'folder' ? value.trim() : item.folder, tags: field === 'tags' ? [...new Set(value.split(',').map(t => t.trim()).filter(Boolean))] : item.tags }));
  }
  const visible = saved.filter(item => (!folder || item.folder === folder) && `${item.craft.name} ${item.folder} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));

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
              <span className={`vab-stock-scale ${s.scale === scale ? 'current' : ''}`}>{s.scale} scale{s.scale === scale ? ' · current' : ''}</span>
              <div className="vab-stock-blurb">{s.blurb}</div>
              <div className="vab-stock-info mono">{s.info}</div>
              {lockedCount(s.craft) > 0 && <div className="vab-stock-locked">Needs research · {lockedCount(s.craft)} locked part type{lockedCount(s.craft) > 1 ? 's' : ''}</div>}
            </button>
          ))}
        </div>
        <div className="vab-modal-section label">Saved vehicles</div>
        <div style={{ display: 'flex', gap: 8 }}><input aria-label="Search craft library" placeholder="Search names, folders, tags" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="Craft folder" value={folder} onChange={e => setFolder(e.target.value)}><option value="">All folders</option>{[...new Set(saved.map(x => x.folder).filter(Boolean))].sort().map(f => <option key={f}>{f}</option>)}</select></div>
        {error && <p role="alert">{error}</p>}
        <div className="vab-saved">
          {visible.map(item => (
            <div key={item.id} className="vab-saved-row" style={{ flexWrap: 'wrap' }}>
              <CraftThumbnail craft={item.craft} />
              <div style={{ flex: 1, minWidth: 150 }}><div className="vab-saved-name">{item.craft.name}</div><div className="vab-saved-info mono">{summary(item.craft)}</div><small>{item.folder || 'Unfiled'} · {item.tags.join(', ')}</small></div>
              <button className="btn small" onClick={() => load(item.craft)}>Load</button>
              <button className="btn small" onClick={() => edit(item, 'name')}>Rename</button>
              <button className="btn small" onClick={() => edit(item, 'folder')}>Folder</button>
              <button className="btn small" onClick={() => edit(item, 'tags')}>Tags</button>
              <button className="btn small" onClick={() => { let name = `${item.craft.name} copy`; let n = 2; while (saved.some(x => x.craft.name === name)) name = `${item.craft.name} copy ${n++}`; refresh(saveLibraryItem({ ...item, id: localId(), craft: { ...item.craft, name }, updatedAt: Date.now() })); }}>Duplicate</button>
              <button className="btn small danger" title="Delete" onClick={() => refresh(craftRepository.remove(item.id))}><Icon name="trash" size={14} /></button>
            </div>
          ))}
          {!visible.length && <div className="vab-empty">No matching vehicles. Use Save (Ctrl+S) to keep your designs.</div>}
        </div>
      </div>
    </div>
  );
}
