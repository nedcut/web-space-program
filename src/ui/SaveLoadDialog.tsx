import { useState } from 'react';
import { loadWorldFromStorage, resumeSave } from '../game/persistence';
import { SLOTS_KEY, exportSaveSlot, importSaveSlot, latestSaveSlot, listSaveSlots, removeSaveSlot, sceneForSave, writeSaveSlot, type SaveSlot } from '../game/saveSlots';
import { downloadFile } from '../game/craftSharing';
import { formatDate } from './format';
export function SaveLoadDialog({ onClose }: { onClose(): void }) {
  const [rev, setRev] = useState(0);
  const [error, setError] = useState('');
  let slots: SaveSlot[] = [];
  try {
    slots = listSaveSlots();
    if (localStorage.getItem(SLOTS_KEY) === null) for (const id of ['autosave', 'quicksave']) {
      const old = loadWorldFromStorage(id);
      if (old) slots.push({ id: `legacy:${id}`, programId: 'legacy-program', name: `Legacy ${id}`, kind: id === 'autosave' ? 'auto' : 'manual', ...old });
    }
  } catch { /* Error is shown when an operation is attempted. */ }
  // Newest first, including legacy slots appended above; Continue resumes the first.
  slots.sort((a, b) => b.savedAt - a.savedAt);
  const latest = latestSaveSlot(slots);
  async function importFile(file: File) {
    try { if (file.size > 20_000_000) throw new Error('Save file exceeds 20 MB.'); writeSaveSlot(importSaveSlot(await file.text())); setRev(rev + 1); setError(''); } catch (e) { setError((e as Error).message); }
  }
  return <div className="panel" style={{ padding: 24, maxWidth: 800, maxHeight: '65vh', overflow: 'auto' }}>
    <h2>Load a program</h2><p>Manual saves and the latest three autosaves per program.</p>
    <input type="file" accept=".wsp-save.json,application/json" aria-label="Import save file" onChange={e => { if (e.target.files?.[0]) void importFile(e.target.files[0]); }} />
    {error && <p role="alert">{error}</p>}
    {latest && <button className="btn primary" onClick={() => resumeSave(latest)}>Continue latest · {latest.name} · {sceneForSave(latest) === 'flight' ? 'in flight' : 'Space Center'}</button>}
    {slots.map(slot => <div key={slot.id} style={{ padding: '12px 0', borderBottom: '1px solid #33404c' }}>
      <strong>{slot.name}</strong> <small>{slot.programId}</small><p>{new Date(slot.savedAt).toLocaleString()} · {formatDate(slot.data.ut)} · {slot.data.mode ?? 'sandbox'} · {slot.data.preset} scale</p>
      <div style={{ display: 'flex', gap: 8 }}><button className="btn small primary" onClick={() => resumeSave(slot)}>Load</button>
      <button className="btn small" onClick={() => downloadFile(`${slot.name.replace(/[^a-z0-9_-]/gi, '_')}.wsp-save.json`, exportSaveSlot(slot))}>Export</button>
      {!slot.id.startsWith('legacy:') && <button className="btn small danger" onClick={() => { try { removeSaveSlot(slot.id); setRev(rev + 1); } catch (e) { setError((e as Error).message); } }}>Delete</button>}</div>
    </div>)}
    {!slots.length && <p>No saved programs yet. Import a save file or start a new game.</p>}
    <button className="btn" style={{ marginTop: 16 }} onClick={onClose}>Back</button>
  </div>;
}
