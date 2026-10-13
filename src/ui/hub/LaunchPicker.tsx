import { useEffect, useMemo, useState } from 'react';
import { game, useGame } from '../../game/store';
import { listLibrary, saveLibraryItem, type LibraryCraft } from '../../game/saves';
import { saveErrorText } from '../../game/storageErrors';
import { Universe } from '../../game/universe';
import { STOCK_CRAFTS } from '../../editor/stockCrafts';
import { matchesQuery } from '../../editor/ui/library';
import { newProgression } from '../../sim/science/progression';
import type { CraftDef } from '../../sim/vessel/types';
import { localId } from '../../util/localId';
import { Badge, Button, Modal } from '../components';
import { arrowNav } from '../nav/arrowNav';
import { facilityLabel } from '../nav/scenes';
import { launchOptions, type LaunchOption } from './quickLaunch';

const SOURCE: Record<LaunchOption['source'], string> = { pad: 'In the Integration Hall', saved: 'Saved', stock: 'Stock' };
const same = (a: CraftDef, b: CraftDef) => JSON.stringify(a) === JSON.stringify(b);

/** Launch straight from the hub: the editor's vehicle, saved designs and stock craft, one click (or Enter) to fly. */
export default function LaunchPicker({ onClose }: { onClose: () => void }) {
  const scale = useGame(s => s.scalePreset);
  const mode = useGame(s => s.mode);
  const pad = useGame(s => s.craft);
  const programProgress = useGame(s => s.resumeWorld?.progression);
  const progression = useMemo(() => programProgress ?? newProgression(), [programProgress]);
  const [saved, setSaved] = useState<LibraryCraft[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [replace, setReplace] = useState<CraftDef | null>(null);
  useEffect(() => {
    let live = true;
    void listLibrary().then(items => { if (live) setSaved(items.sort((a, b) => b.updatedAt - a.updatedAt)); }).catch(e => { if (live) { setSaved([]); setError((e as Error).message); } });
    return () => { live = false; };
  }, []);
  const earth = useMemo(() => new Universe(scale).body('earth'), [scale]);
  const stock = useMemo(() => STOCK_CRAFTS.filter(s => s.scale === scale).map(s => ({ id: s.id, craft: s.build(), blurb: s.blurb })), [scale]);
  // Stage simulation per craft: once per library load, not per keystroke.
  const options = useMemo(() => launchOptions({ pad, saved: saved ?? [], stock, mode, progression, earth }),
    [pad, saved, stock, mode, progression, earth]);
  const blurb = new Map(stock.map(s => [`stock:${s.id}`, s.blurb]));
  const visible = options.filter(o => matchesQuery(`${o.craft.name} ${SOURCE[o.source]} ${blurb.get(o.key) ?? ''}`, query));

  // The editor draft lives only in the Integration Hall; launching something else replaces it there.
  const draftAtRisk = (craft: CraftDef) => !!pad?.parts.length && craft !== pad && saved !== null
    && !saved.some(s => same(s.craft, pad)) && !stock.some(s => same(s.craft, pad));
  const fly = (craft: CraftDef) => game.set({ craft, scene: 'flight', launchPending: true });
  const choose = (o: LaunchOption) => { if (o.blocked) return; if (draftAtRisk(o.craft)) setReplace(o.craft); else fly(o.craft); };
  const saveDraftThenFly = (craft: CraftDef) => {
    if (!pad) return;
    void saveLibraryItem({ id: localId(), craft: pad, folder: '', tags: [], updatedAt: Date.now() }).then(() => fly(craft)).catch(e => { setReplace(null); setError(saveErrorText(e)); });
  };
  const edit = (craft: CraftDef) => game.set({ craft, scene: 'editor' });
  const first = visible.find(o => !o.blocked);

  return (
    <Modal title={pad?.type === 'SPH' ? 'Runway' : 'Launch Pad'} onClose={onClose} className="hub-launch">
      <div className="hub-launch-bar">
        <input aria-label="Search vehicles" placeholder="Search vehicles" value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && first) choose(first); if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.closest('dialog')?.querySelector<HTMLElement>('.hub-launch-row:not(:disabled)')?.focus(); } }} />
        <span className="label">Enter flies the highlighted vehicle</span>
      </div>
      {error && <p role="alert" className="hub-launch-error">{error}</p>}
      <div className="hub-launch-list" onKeyDown={e => arrowNav(e, '.hub-launch-row:not(:disabled)')}>
        {visible.map(o => (
          <div key={o.key} className={`hub-launch-item${o.source === 'pad' ? ' pad' : ''}`}>
            <button type="button" className="hub-launch-row" disabled={!!o.blocked} data-autofocus={o === first ? true : undefined} onClick={() => choose(o)}
              aria-label={`Launch ${o.craft.name}${o.blocked ? ` (unavailable: ${o.blocked})` : ''}`}>
              <span className="hub-launch-name"><strong>{o.craft.name}</strong><Badge>{SOURCE[o.source]}</Badge>{o.craft.type === 'SPH' && <Badge>Runway</Badge>}</span>
              <span className="mono hub-launch-info">{o.info}</span>
              {o.blocked ? <span className="hub-launch-blocked">{o.blocked}</span> : o.warning && <span className="hub-launch-warn">{o.warning}</span>}
            </button>
            <Button className="btn small ghost" onClick={() => edit(o.craft)} aria-label={`Open ${o.craft.name} in the ${facilityLabel('editor')}`}>Edit</Button>
          </div>
        ))}
        {saved === null && <div className="hub-launch-empty">Reading the craft library…</div>}
        {saved !== null && !visible.length && <div className="hub-launch-empty">{options.length ? 'No vehicles match.' : 'No vehicles yet.'}</div>}
      </div>
      {replace && <Modal title="Replace the Integration Hall draft?" onClose={() => setReplace(null)} className="ui-modal-small">
        <div className="ui-modal-body">“{pad?.name}” is not in your craft library. Launching “{replace.name}” replaces it in the {facilityLabel('editor')}.</div>
        <div className="ui-modal-actions">
          <Button className="btn" onClick={() => setReplace(null)}>Cancel</Button>
          <Button className="btn" onClick={() => fly(replace)}>Launch without saving</Button>
          <Button className="btn primary" data-autofocus onClick={() => saveDraftThenFly(replace)}>Save draft and launch</Button>
        </div>
      </Modal>}
    </Modal>
  );
}
