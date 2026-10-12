import { useEffect, useState } from 'react';
import { PART_CATALOG } from '../../data/parts';
import { decodeCraft, MAX_CRAFT_BYTES, validateCraft, type CraftImport } from '../../game/craftSharing';
import { CraftThumbnail } from './CraftThumbnail';
import type { EditorSession } from '../session';
import { useEscape } from '../../ui/nav/escape';
export function CraftImportDialog({ session, initial = '', file, onClose }: { session: EditorSession; initial?: string; file?: File; onClose(): void }) {
  useEscape(onClose, true, 'modal');
  const [code, setCode] = useState(initial);
  const [result, setResult] = useState<CraftImport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
  return <div className="vab-modal-backdrop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) void readFile(e.dataTransfer.files[0]); }}>
    <div className="vab-modal panel" style={{ maxWidth: 600, padding: 24 }}>
      <h2>Import vehicle</h2><p>Paste a share code or link, choose a .craft.json file, or drop it here.</p>
      <textarea aria-label="Craft share code" value={code} onChange={e => setCode(e.target.value)} rows={4} style={{ width: '100%' }} />
      <button className="btn" disabled={busy} onClick={() => void inspect(code)}>Preview code</button>
      <input aria-label="Import craft file" type="file" accept=".craft.json,application/json" disabled={busy} onChange={e => { if (e.target.files?.[0]) void readFile(e.target.files[0]); }} />
      {error && <p role="alert">{error}</p>}
      {result && <><p role="alert">{result.errors.join(' ')}{result.unknownParts.length > 0 && `Unknown parts: ${result.unknownParts.join(', ')}`}</p>
        {result.craft && <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}><CraftThumbnail craft={result.craft} /><div>{result.craft.name}<p>{result.craft.parts.length} parts · {result.craft.type}</p></div></div>}</>}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button className="btn primary" disabled={!result?.craft || busy} onClick={() => { if (result?.craft) { session.load(result.craft); onClose(); } }}>Load vehicle</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </div>
  </div>;
}
