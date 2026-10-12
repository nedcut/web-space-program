import { useEffect, useMemo, useState } from 'react';
import { loadWorldFromStorage, resumeSave } from '../game/persistence';
import { SLOTS_KEY, exportSaveSlot, importSaveSlot, listSaveSlots, removeSaveSlot, writeSaveSlot, type SaveSlot } from '../game/saveSlots';
import { downloadFile } from '../game/craftSharing';
import { PART_CATALOG } from '../data/parts';
import { formatDate } from './format';
import { Badge, Button, ConfirmModal, EmptyState, Kbd, Panel } from './components';
import { Icon } from './components/Icon';
import { arrowNav } from './nav/arrowNav';
import { flyingCount, groupByProgram, modeLabel, previewCraft, saveWhere, savedAgo, scaleLabel, type ProgramSaves } from './saveSummary';

/**
 * Every save slot, newest first, including pre-slot (legacy) saves that were never migrated.
 * Parses the save index: call on interaction (menu mount, opening Load), never per frame.
 */
export function readSaveSlots(): SaveSlot[] {
  let slots: SaveSlot[] = [];
  try {
    slots = listSaveSlots();
    if (localStorage.getItem(SLOTS_KEY) === null) for (const id of ['autosave', 'quicksave']) {
      const old = loadWorldFromStorage(id);
      if (old) slots.push({ id: `legacy:${id}`, programId: 'legacy-program', name: id === 'autosave' ? 'Autosave' : 'Quicksave', kind: id === 'autosave' ? 'auto' : 'manual', ...old });
    }
  } catch { /* Unreadable storage: the error is shown when an operation is attempted. */ }
  return slots.sort((a, b) => b.savedAt - a.savedAt);
}

const fileName = (slot: SaveSlot) => `${slot.name.replace(/[^a-z0-9_-]/gi, '_')}.wsp-save.json`;
const exportSlot = (slot: SaveSlot) => downloadFile(fileName(slot), exportSaveSlot(slot));
const deletable = (slot: SaveSlot) => !slot.id.startsWith('legacy:');

/** Small picture of the save's active vessel (or editor draft), rendered on the shared idle thumbnail queue. */
const thumbs = new Map<string, string>();
function SaveThumb({ slot }: { slot: SaveSlot }) {
  const key = `${slot.id}@${slot.savedAt}`;
  const [url, setUrl] = useState(() => thumbs.get(key) ?? '');
  useEffect(() => {
    if (thumbs.has(key)) { setUrl(thumbs.get(key)!); return; }
    const craft = previewCraft(slot);
    if (!craft) return;
    let cancel: (() => void) | undefined, dead = false;
    // three.js and the thumbnail renderer load only when a save card is shown.
    void import('../editor/scene/thumbnails').then(m => {
      if (dead) return;
      cancel = m.requestCraftThumbnail(craft, PART_CATALOG, image => {
        if (image) { thumbs.set(key, image); if (thumbs.size > 32) thumbs.delete(thumbs.keys().next().value!); }
        setUrl(image);
      });
    }).catch(() => { /* No preview without WebGL. */ });
    return () => { dead = true; cancel?.(); };
  }, [key, slot]);
  return <div className="load-thumb" aria-hidden="true">{url ? <img src={url} alt="" /> : <Icon name={slot.scene === 'flight' ? 'rocket' : 'orbit'} size={28} />}</div>;
}

type Pending = { kind: 'slot'; slot: SaveSlot } | { kind: 'program'; program: ProgramSaves };

function ProgramCard({ program, onDelete }: { program: ProgramSaves; onDelete: (p: Pending) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { latest } = program;
  const vessels = flyingCount(latest);
  return <article className="load-program" aria-label={program.title}>
    <SaveThumb slot={latest} />
    <div className="load-program-main">
      <div className="load-program-title"><h3>{program.title}</h3><Badge>{modeLabel(latest.data.mode)}</Badge></div>
      <p className="load-meta">{scaleLabel(latest.data.preset)} · {formatDate(latest.data.ut)} · {vessels} {vessels === 1 ? 'vessel' : 'vessels'}</p>
      <p className="load-latest"><strong>{latest.name}</strong> · {saveWhere(latest)} · saved {savedAgo(latest.savedAt)}</p>
      <div className="load-actions">
        <Button className="btn primary" onClick={() => resumeSave(latest)}>Resume</Button>
        {program.slots.length > 1 && <Button className="btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide saves' : `All saves (${program.slots.length})`}</Button>}
        <Button className="btn ghost" onClick={() => exportSlot(latest)}>Export</Button>
        {program.slots.some(deletable) && <Button className="btn ghost danger" onClick={() => onDelete({ kind: 'program', program })}>Delete…</Button>}
      </div>
      {expanded && <ul className="load-slots">{program.slots.map(slot => <li key={slot.id}>
        <span className="load-slot-name"><strong>{slot.name}</strong>{slot.kind === 'auto' && <small> auto</small>}</span>
        <span className="load-slot-where">{saveWhere(slot)} · {formatDate(slot.data.ut)}</span>
        <span className="load-slot-when">{savedAgo(slot.savedAt)}</span>
        <span className="load-slot-actions">
          <Button className="btn small primary" onClick={() => resumeSave(slot)}>Load</Button>
          <Button className="btn small ghost" onClick={() => exportSlot(slot)}>Export</Button>
          {deletable(slot) && <Button className="btn small ghost danger" aria-label={`Delete ${slot.name}`} onClick={() => onDelete({ kind: 'slot', slot })}><Icon name="trash" size={14} /></Button>}
        </span>
      </li>)}</ul>}
    </div>
  </article>;
}

export function SaveLoadDialog({ onClose }: { onClose(): void }) {
  const [rev, setRev] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  // Parsed once per change, not per render.
  const programs = useMemo(() => groupByProgram(readSaveSlots()), [rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveCount = programs.reduce((n, p) => n + p.slots.length, 0);

  async function importFile(file: File) {
    try {
      if (file.size > 20_000_000) throw new Error('Save file exceeds 20 MB.');
      const slot = importSaveSlot(await file.text());
      writeSaveSlot(slot);
      setRev(r => r + 1); setError(''); setNotice(`Imported “${slot.name}”.`);
    } catch (e) { setNotice(''); setError((e as Error).message); }
  }
  const remove = (p: Pending) => {
    try {
      for (const slot of p.kind === 'slot' ? [p.slot] : p.program.slots.filter(deletable)) removeSaveSlot(slot.id);
      setRev(r => r + 1); setNotice('');
    } catch (e) { setError((e as Error).message); }
    setPending(null);
  };

  return <Panel className={`load-panel${dragging ? ' dragging' : ''}`} role="region" aria-label="Load a program"
    onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
    onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false); }}
    onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void importFile(f); }}>
    <header className="load-head">
      <h2>Load a program</h2>
      <span className="label">{programs.length} {programs.length === 1 ? 'program' : 'programs'} · {saveCount} {saveCount === 1 ? 'save' : 'saves'}</span>
    </header>
    {error && <p role="alert" className="load-error">{error}</p>}
    {notice && <p role="status" className="load-notice">{notice}</p>}
    <div className="load-list" onKeyDown={e => arrowNav(e)}>
      {programs.map(p => <ProgramCard key={p.programId} program={p} onDelete={setPending} />)}
      {!programs.length && <EmptyState title="No saved programs yet">Start a new game, or import a save file below.</EmptyState>}
    </div>
    <label className="load-drop">
      <input type="file" className="visually-hidden" accept=".wsp-save.json,application/json" aria-label="Import save file" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
      <Icon name="import" size={18} /><span><strong>Import a save file</strong> — drop a <code>.wsp-save.json</code> here or click to browse. Manual saves and the latest three autosaves per program are kept.</span>
    </label>
    <div className="load-foot"><Button className="btn" onClick={onClose}>Back <Kbd>Esc</Kbd></Button></div>
    {pending && <ConfirmModal danger confirmLabel="Delete"
      title={pending.kind === 'slot' ? `Delete “${pending.slot.name}”?` : `Delete ${pending.program.title.split(' · ')[0].toLowerCase()}?`}
      onCancel={() => setPending(null)} onConfirm={() => remove(pending)}>
      {pending.kind === 'slot' ? 'This save is removed from this browser. Export it first to keep a copy.'
        : `All ${pending.program.slots.filter(deletable).length} saves of this program are removed from this browser. Export the latest first to keep a copy.`}
    </ConfirmModal>}
  </Panel>;
}
