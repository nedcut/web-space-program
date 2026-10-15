import { localId } from '../../util/localId';
import { listLibrary, saveLibraryItem, craftRepository, type LibraryCraft } from '../../game/saves';
import { CraftThumbnail } from './CraftThumbnail';
import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../../game/store';
import { Universe } from '../../game/universe';
import { newProgression } from '../../sim/science/progression';
import type { CraftDef } from '../../sim/vessel/types';
import { craftStats } from '../core';
import { CATALOG, DENSITIES, type EditorSession } from '../session';
import { STOCK_CRAFTS, type StockCategory } from '../stockCrafts';
import { STOCK_CATEGORIES, groupStock, stockCategory, stockFeatures, unlockText, unlockingResearch } from '../stock/guide';
import { computeStageStats } from './dv';
import { Icon } from './icons';
import { fmtDv, fmtKg } from './partInfo';
import { saveErrorText } from '../../game/storageErrors';
import { Button, ConfirmModal, Modal, PromptModal } from '../../ui/components';
import { arrowNav } from '../../ui/nav/arrowNav';
import { filterLibrary, matchesQuery, type LibrarySort } from './library';

function summary(craft: CraftDef, earth: ReturnType<Universe['body']>) {
  try {
    const s = craftStats(craft, CATALOG, DENSITIES);
    let dv = 0;
    for (const x of computeStageStats(craft, CATALOG, earth).values()) dv += x.dvVac;
    return `${s.partCount} parts · ${fmtKg(s.totalMass)} · ${s.height.toFixed(1)} m · ${fmtDv(dv)}`;
  } catch {
    return `${craft.parts.length} parts`;
  }
}

/** Stock designs are static: build them and their summaries once per scale, not on every library open (~2 ms each). */
function buildStock(earth: ReturnType<Universe['body']>) {
  return STOCK_CRAFTS.map((s) => {
    const craft = s.build();
    return { ...s, craft, info: summary(craft, earth), category: stockCategory(s, craft), features: stockFeatures(s, craft) };
  });
}
const builtStock = new Map<string, ReturnType<typeof buildStock>>();

const SCALE_NAME: Record<string, string> = { standard: 'Standard', challenging: 'Challenging', real: 'Real' };
const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });

type Edit = { item: LibraryCraft; field: 'name' | 'folder' | 'tags' } | { item: LibraryCraft; field: 'delete' } | { craft: CraftDef; field: 'replace' };

export function LoadDialog({ session, onClose }: { session: EditorSession; onClose(): void }) {
  const [rev, setRev] = useState(0);
  const scale = useGame(s => s.scalePreset);
  const mode = useGame((s) => s.mode);
  const programProgress = useGame((s) => s.resumeWorld?.progression);
  const progression = useMemo(() => programProgress ?? newProgression(), [programProgress]);
  const earth = useMemo(() => new Universe(scale).body('earth'), [scale]);
  const built = useMemo(() => {
    let list = builtStock.get(scale);
    // Loading copies the craft (the editor deserializes it, merging clones its parts), so cached designs stay pristine.
    if (!list) builtStock.set(scale, list = buildStock(earth));
    return list;
  }, [scale, earth]);
  // Research still missing per design: recomputed when the program unlocks something, not per keystroke.
  const stock = useMemo(() => built.map(s => ({ ...s, unlock: unlockText(unlockingResearch(s.craft, mode, progression)) })), [built, mode, progression]);
  const [group, setGroup] = useState<StockCategory | ''>('');
  const [saved, setSaved] = useState<LibraryCraft[] | null>(null);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [allScales, setAllScales] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  useEffect(() => { let live = true; void listLibrary().then(items => { if (live) setSaved(items); }).catch(e => { if (live) { setSaved([]); setError((e as Error).message); } }); return () => { live = false; }; }, [rev]);
  const library = useMemo(() => saved ?? [], [saved]);
  // Stats need a stage simulation per craft: computed once per library load, not per keystroke.
  const infos = useMemo(() => new Map(library.map(item => [item.id, summary(item.craft, earth)])), [library, earth]);
  const refresh = (action: Promise<unknown>) => void action.then(() => setRev(r => r + 1)).catch(e => setError(saveErrorText(e)));
  const update = (item: LibraryCraft, patch: Partial<LibraryCraft>) => refresh(saveLibraryItem({ ...item, ...patch, updatedAt: Date.now() }));
  const folders = [...new Set(library.map(x => x.folder).filter(Boolean))].sort();
  const visible = filterLibrary(library, { query, folder, sort });
  const stockMatching = stock.filter(s => (allScales || s.scale === scale)
    && matchesQuery(`${s.name} ${s.blurb} ${s.features.join(' ')} ${s.tip ?? ''} ${STOCK_CATEGORIES.find(c => c.id === s.category)?.label}`, query));
  const stockGroups = groupStock(stockMatching);
  const stockVisible = group ? stockGroups.filter(g => g.id === group) : stockGroups;
  const otherScales = stock.filter(s => s.scale !== scale).length;

  // Merge: the other craft comes in as a held assembly (its root part on the cursor) instead of replacing this one.
  const [merge, setMerge] = useState(false);
  const canMerge = session.getSnapshot().craft.parts.length > 0;
  const commit = (c: CraftDef) => {
    if (merge && canMerge) session.mergeCraft(c); else session.load(c);
    onClose();
  };
  const load = (c: CraftDef) => (!(merge && canMerge) && session.getSnapshot().dirty ? setEdit({ craft: c, field: 'replace' }) : commit(c));
  const duplicate = (item: LibraryCraft) => {
    let name = `${item.craft.name} copy`;
    for (let n = 2; library.some(x => x.craft.name === name); n++) name = `${item.craft.name} copy ${n}`;
    refresh(saveLibraryItem({ ...item, id: localId(), craft: { ...item.craft, name }, updatedAt: Date.now() }));
  };

  return (
    <Modal title="Craft library" onClose={onClose} className="vab-library">
      <div className="vab-lib-bar">
        <label className="vab-search vab-lib-search">
          <Icon name="search" size={15} />
          <input data-autofocus aria-label="Search vehicles" placeholder="Search vehicles, folders, tags" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        {folders.length > 0 && <select aria-label="Folder" value={folder} onChange={e => setFolder(e.target.value)}><option value="">All folders</option>{folders.map(f => <option key={f}>{f}</option>)}</select>}
        <select aria-label="Sort saved vehicles" value={sort} onChange={e => setSort(e.target.value as LibrarySort)}>
          <option value="recent">Recently saved</option><option value="name">Name</option><option value="parts">Part count</option>
        </select>
        <label className="vab-merge" title={canMerge ? 'Pick up the chosen vehicle and attach it to the current one' : 'Build or load something first'}>
          <input type="checkbox" checked={merge && canMerge} disabled={!canMerge} onChange={e => setMerge(e.target.checked)} /> Merge into current craft
        </label>
      </div>
      {error && <p className="vab-lib-error" role="alert">{error}</p>}

      <div className="vab-modal-section label">Saved vehicles{saved && library.length > 0 && <span className="vab-lib-count"> · {visible.length === library.length ? library.length : `${visible.length} of ${library.length}`}</span>}</div>
      <div className="vab-saved">
        {visible.map(item => (
          <div key={item.id} className="vab-saved-row">
            <CraftThumbnail craft={item.craft} />
            <div className="vab-saved-main">
              <div className="vab-saved-name">{item.craft.name}</div>
              <div className="vab-saved-info mono">{infos.get(item.id)}</div>
              <div className="vab-saved-meta">
                <span>{when(item.updatedAt)}</span>
                {item.folder && <span className="ui-badge">{item.folder}</span>}
                {item.tags.map(t => <span key={t} className="vab-tag">#{t}</span>)}
              </div>
            </div>
            <div className="vab-saved-actions">
              <Button className="btn small primary" onClick={() => load(item.craft)}>{merge && canMerge ? 'Merge' : 'Load'}</Button>
              <Button className="btn small ghost" onClick={() => setEdit({ item, field: 'name' })}>Rename</Button>
              <Button className="btn small ghost" onClick={() => setEdit({ item, field: 'folder' })}>Folder</Button>
              <Button className="btn small ghost" onClick={() => setEdit({ item, field: 'tags' })}>Tags</Button>
              <Button className="btn small ghost" onClick={() => duplicate(item)}>Duplicate</Button>
              <Button className="btn small ghost danger" aria-label={`Delete ${item.craft.name}`} title="Delete" onClick={() => setEdit({ item, field: 'delete' })}><Icon name="trash" size={14} /></Button>
            </div>
          </div>
        ))}
        {saved && !visible.length && <div className="vab-empty">{library.length ? 'No saved vehicles match.' : 'No saved vehicles yet. Save (Ctrl+S) keeps your designs here.'}</div>}
      </div>

      <div className="vab-modal-section vab-lib-stock-head">
        <span className="label">Stock vehicles</span>
        {otherScales > 0 && <label className="vab-merge"><input type="checkbox" checked={allScales} onChange={e => setAllScales(e.target.checked)} /> Show other scales ({otherScales})</label>}
      </div>
      {stockGroups.length > 1 && <div className="vab-stock-chips" role="group" aria-label="Stock vehicle groups">
        {[{ id: '' as const, label: 'All', items: stockMatching }, ...stockGroups].map(g => (
          <button type="button" key={g.id} className="vab-stock-chip" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
            {g.label} <span className="vab-lib-count">{g.items.length}</span>
          </button>
        ))}
      </div>}
      <div className="vab-stock-groups" onKeyDown={e => arrowNav(e, '.vab-stock')}>
        {stockVisible.map(g => (
          <section key={g.id} className="vab-stock-group" aria-label={g.label}>
            <h3 className="vab-stock-group-head label">{g.label}</h3>
            <div className="vab-stock-grid">
              {g.items.map((s) => (
                <button type="button" key={s.id} className="vab-stock" onClick={() => load(s.craft)}>
                  <div className="vab-stock-icon"><CraftThumbnail craft={s.craft} /></div>
                  <div className="vab-stock-name">{s.name}</div>
                  {s.scale !== scale && <span className="vab-stock-scale">Built for {SCALE_NAME[s.scale] ?? s.scale} scale</span>}
                  <div className="vab-stock-blurb">{s.blurb.replace(/ · research required$/, '').replace(new RegExp(`^${SCALE_NAME[scale]} scale · `), '')}</div>
                  {s.features.length > 0 && <div className="vab-stock-features"><span>Features</span> {s.features.join(' · ')}</div>}
                  {s.tip && <div className="vab-stock-tip"><span>Try this</span> {s.tip}</div>}
                  <div className="vab-stock-info mono">{s.info}</div>
                  {s.unlock && <div className="vab-stock-locked">Locked · {s.unlock}</div>}
                </button>
              ))}
            </div>
          </section>
        ))}
        {!stockVisible.length && <div className="vab-empty">No stock vehicles match.</div>}
      </div>

      {edit?.field === 'name' && <PromptModal title="Rename vehicle" label="Name" initial={edit.item.craft.name} submitLabel="Rename" onCancel={() => setEdit(null)} onSubmit={value => {
        const name = value.slice(0, 200);
        if (library.some(x => x.id !== edit.item.id && x.craft.name === name)) { setError(`“${name}” is already used by another vehicle.`); return; }
        setError(''); setEdit(null); update(edit.item, { craft: { ...edit.item.craft, name } });
      }} />}
      {(edit?.field === 'folder' || edit?.field === 'tags') && <FieldModal
        title={edit.field === 'folder' ? 'Move to folder' : 'Edit tags'}
        label={edit.field === 'folder' ? 'Folder (empty = unfiled)' : 'Tags, separated by commas'}
        initial={edit.field === 'folder' ? edit.item.folder : edit.item.tags.join(', ')}
        suggestions={edit.field === 'folder' ? folders : undefined}
        onCancel={() => setEdit(null)}
        onSubmit={value => {
          setEdit(null);
          update(edit.item, edit.field === 'folder' ? { folder: value.trim() } : { tags: [...new Set(value.split(',').map(t => t.trim()).filter(Boolean))] });
        }} />}
      {edit?.field === 'delete' && <ConfirmModal title="Delete vehicle?" confirmLabel="Delete" danger onCancel={() => setEdit(null)} onConfirm={() => { setEdit(null); refresh(craftRepository.remove(edit.item.id)); }}>
        “{edit.item.craft.name}” will be removed from the craft library. This cannot be undone.
      </ConfirmModal>}
      {edit?.field === 'replace' && <ConfirmModal title="Replace the current craft?" confirmLabel="Discard and load" danger onCancel={() => setEdit(null)} onConfirm={() => { setEdit(null); commit(edit.craft); }}>
        “{session.getSnapshot().name}” has unsaved changes. Tick “Merge into current craft” to attach the vehicle instead.
      </ConfirmModal>}
    </Modal>
  );
}

/** Like PromptModal, but an empty value is allowed (clear a folder or the tags). */
function FieldModal({ title, label, initial, suggestions, onSubmit, onCancel }: { title: string; label: string; initial: string; suggestions?: string[]; onSubmit(value: string): void; onCancel(): void }) {
  const [value, setValue] = useState(initial);
  return <Modal title={title} onClose={onCancel} className="ui-modal-small">
    <form onSubmit={e => { e.preventDefault(); onSubmit(value); }}>
      <label className="ui-field"><span>{label}</span><input data-autofocus value={value} list={suggestions?.length ? 'vab-folder-list' : undefined} onChange={e => setValue(e.target.value)} onFocus={e => e.currentTarget.select()} /></label>
      {suggestions && <datalist id="vab-folder-list">{suggestions.map(f => <option key={f} value={f} />)}</datalist>}
      <div className="ui-modal-actions"><Button className="btn" onClick={onCancel}>Cancel</Button><Button type="submit" className="btn primary">Save</Button></div>
    </form>
  </Modal>;
}
