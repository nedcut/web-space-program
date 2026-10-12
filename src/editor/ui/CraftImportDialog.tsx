import { useEffect, useRef, useState } from 'react';
import { PART_CATALOG } from '../../data/parts';
import { decodeCraft, MAX_CRAFT_BYTES, validateCraft, type CraftImport } from '../../game/craftSharing';
import { CraftThumbnail } from './CraftThumbnail';
import type { EditorSession } from '../session';
import { Button, ConfirmModal, Modal } from '../../ui/components';

export function CraftImportDialog({ session, initial = '', file, onClose }: { session: EditorSession; initial?: string; file?: File; onClose(): void }) {
  const [code, setCode] = useState(initial);
  const [result, setResult] = useState<CraftImport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  async function inspect(text: string, json = false) {
    setBusy(true); setError(''); setResult(null);
    try { if (text.length > MAX_CRAFT_BYTES * 1.4) throw new Error('Craft exceeds size limit.'); setResult(validateCraft(json ? JSON.parse(text) : await decodeCraft(text), PART_CATALOG)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function readFile(f: File) {
    if (f.size > MAX_CRAFT_BYTES) { setError('Craft file exceeds size limit.'); return; }
    await inspect(await f.text(), true);
  }
  useEffect(() => {
    if (file) void readFile(file); else if (initial) void inspect(initial);
    // Initial imports are inspected once on opening the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, initial]);
  const load = () => { if (result?.craft) { session.load(result.craft); onClose(); } };
  const problems = result ? [...result.errors, ...(result.unknownParts.length ? [`Unknown parts: ${result.unknownParts.join(', ')}`] : [])] : [];
  return <Modal title="Import vehicle" onClose={onClose} className="vab-import">
    <div className={`vab-dropzone ${dragging ? 'over' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragging(false); if (e.dataTransfer.files[0]) void readFile(e.dataTransfer.files[0]); }}>
      <label className="ui-field"><span>Share code or link</span>
        <textarea data-autofocus className="vab-share-code mono" aria-label="Craft share code" value={code} rows={4} placeholder="Paste a share code or a link containing #craft=…"
          onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void inspect(code); } }} />
      </label>
      <div className="vab-import-row">
        <Button className="btn" disabled={busy || !code.trim()} onClick={() => void inspect(code)}>Preview code</Button>
        <span className="vab-import-or">or</span>
        <Button className="btn" disabled={busy} onClick={() => picker.current?.click()}>Choose .craft.json file…</Button>
        <input ref={picker} hidden aria-label="Import craft file" type="file" accept=".craft.json,application/json" onChange={e => { if (e.target.files?.[0]) void readFile(e.target.files[0]); e.target.value = ''; }} />
        <span className="vab-import-hint">or drop a file here</span>
      </div>
    </div>
    {error && <p className="vab-lib-error" role="alert">{error}</p>}
    {problems.length > 0 && <p className="vab-lib-error" role="alert">{problems.join(' ')}</p>}
    {result?.craft && <div className="vab-import-preview"><CraftThumbnail craft={result.craft} /><div><div className="vab-saved-name">{result.craft.name}</div><div className="vab-saved-info mono">{result.craft.parts.length} parts · {result.craft.type}</div></div></div>}
    <div className="ui-modal-actions">
      <Button className="btn" onClick={onClose}>Cancel</Button>
      <Button className="btn primary" disabled={!result?.craft || busy} onClick={() => { if (session.getSnapshot().dirty) setConfirm(true); else load(); }}>Load vehicle</Button>
    </div>
    {confirm && <ConfirmModal title="Replace the current craft?" confirmLabel="Discard and load" danger onCancel={() => setConfirm(false)} onConfirm={load}>
      “{session.getSnapshot().name}” has unsaved changes that will be lost.
    </ConfirmModal>}
  </Modal>;
}
