import { useEffect, useState } from 'react';
import { game } from '../game/store';
import { STOCK_CRAFTS } from '../editor/stockCrafts';
import { WARP_RATES, validCraft } from './protocol';
import type { MultiplayerClient } from './client';
import './multiplayer.css';

/** Host URL and display name from the last successful join, so rejoining is one click. */
const LAST_KEY = 'wsp.multiplayer.last.v1';
function lastJoin(): { url?: string; name?: string } {
  try { const v: unknown = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}'); return v && typeof v === 'object' ? v as { url?: string; name?: string } : {}; } catch { return {}; }
}

export function MultiplayerSetup({ onBack }: { onBack: () => void }) {
  const [last] = useState(lastJoin);
  const [url, setUrl] = useState(typeof last.url === 'string' ? last.url : `ws://${location.hostname || 'localhost'}:8787`);
  const [room, setRoom] = useState('');
  const [name, setName] = useState(typeof last.name === 'string' ? last.name : 'Pilot');
  const [error, setError] = useState('');
  return <form className="panel multiplayer-setup" onSubmit={e => {
    e.preventDefault();
    try {
      if (!['ws:', 'wss:'].includes(new URL(url).protocol)) throw new Error('Use ws:// or wss://');
      if (!name.trim()) throw new Error('Enter a display name');
      try { localStorage.setItem(LAST_KEY, JSON.stringify({ url, name: name.trim() })); } catch { /* storage unavailable */ }
      game.set({ multiplayer: { url, room: room.trim().toUpperCase(), name: name.trim() }, scene: 'flight' });
    } catch (e) { setError((e as Error).message); }
  }}>
    <strong>Multiplayer (experimental)</strong>
    <p>LAN co-op · up to 4 pilots · shared clock. Run <code>npm run server</code> on the host first. Rooms last only while the server is running.</p>
    <label>Host URL<input aria-label="Host URL" required value={url} onChange={e => setUrl(e.target.value)} /></label>
    <label>Room code<input aria-label="Room code" maxLength={8} pattern="[a-zA-Z0-9]{4,8}|" placeholder="Empty = create a room" value={room} onChange={e => setRoom(e.target.value)} /></label>
    <label>Display name<input aria-label="Display name" required maxLength={24} value={name} onChange={e => setName(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <div className="mp-row mp-actions"><button type="button" className="btn ghost" onClick={onBack}>Back</button><button className="btn primary" type="submit">{room.trim() ? 'Join room' : 'Create room'}</button></div>
  </form>;
}

export function MultiplayerPanel({ client }: { client: MultiplayerClient }) {
  const [, refresh] = useState(0);
  const [chat, setChat] = useState('');
  const [craftId, setCraftId] = useState(STOCK_CRAFTS[0].id);
  const [localError, setLocalError] = useState('');
  useEffect(() => client.subscribe(() => refresh(n => n + 1)), [client]);
  const me = client.room.players.find(p => p.id === client.playerId);
  const queued = client.room.queue.find(q => q.playerId === client.playerId);
  const launch = (id: string) => {
    const craft = id === 'editor' ? game.get().craft : STOCK_CRAFTS.find(c => c.id === id)?.build();
    if (craft) client.send({ v: 1, type: 'launch', craft, site: craft.type === 'SPH' ? 'runway' : 'pad' });
  };
  return <aside className="panel multiplayer-panel" aria-label="Multiplayer controls">
    <strong>Multiplayer · experimental</strong>
    <div>{client.status} {client.roomCode && <>· Room <b className="mono">{client.roomCode}</b></>}</div>
    {(client.error || localError) && <p role="alert" className="mp-error">{localError || client.error}</p>}
    <div className="mp-row">
      <span>Shared warp: {client.room.rate}×</span>
      <label>Your request <select aria-label="Requested warp" disabled={!client.connected} value={me?.warp ?? 1} onChange={e => client.send({ v: 1, type: 'warp', rate: +e.target.value })}>
        {WARP_RATES.map(r => <option key={r} value={r}>{r}×</option>)}
      </select></label>
    </div>
    <small>Holding warp: {client.room.players.filter(p => client.room.heldBy.includes(p.id)).map(p => p.name).join(', ') || '—'}{client.room.rate < client.room.requestedRate ? ' · vessel safety limit' : ''}</small>
    <ul className="mp-players">{client.room.players.map(p => <li key={p.id}>{p.name}{p.id === client.playerId ? ' (you)' : ''} · {p.vesselId ? client.world.vessels.get(p.vesselId)?.state.name ?? 'Flying' : 'Spectating'} · {p.warp}×</li>)}</ul>
    <details open={!me?.vesselId}>
      <summary>Fleet & launch</summary>
      <p className="mp-help">Claim a free vessel or request a launch. Pad/runway requests wait until the site is clear.</p>
      <div className="mp-row"><select aria-label="Launch craft" value={craftId} onChange={e => setCraftId(e.target.value)}>
        {STOCK_CRAFTS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        {game.get().craft && <option value="editor">Editor: {game.get().craft!.name}</option>}
      </select><button className="btn small" disabled={!client.connected || !!queued} onClick={() => launch(craftId)}>Launch</button></div>
      <label className="mp-import">Or launch a craft JSON <input aria-label="Import craft JSON" type="file" accept=".json" disabled={!client.connected || !!queued} onChange={async e => {
        try {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 400_000) throw new Error('Craft file too large');
          const craft: unknown = JSON.parse(await file.text());
          if (!validCraft(craft)) throw new Error('Invalid craft (maximum 200 parts)');
          client.send({ v: 1, type: 'launch', craft, site: craft.type === 'SPH' ? 'runway' : 'pad' });
          setLocalError('');
        } catch (e) { setLocalError((e as Error).message); }
      }} /></label>
      {queued && <p role="status">Queued for {queued.site}; waiting for 200 m clearance.</p>}
      <div className="mp-fleet">{[...client.world.vessels.values()].map(v => {
        const owner = client.room.players.find(p => p.vesselId === v.state.id);
        return <div className="mp-row" key={v.state.id}><span>{v.state.name} · {owner?.name ?? 'Free'}</span><button className="btn small" disabled={!client.connected || !!owner} onClick={() => client.send({ v: 1, type: 'claim', vesselId: v.state.id })}>Claim</button><button className="btn small" disabled={!!me?.vesselId && me.vesselId !== v.state.id} onClick={() => { client.world.activeId = v.state.id; }}>View</button></div>;
      })}</div>
      {me?.vesselId && <button className="btn small" onClick={() => client.send({ v: 1, type: 'release' })}>Release vessel</button>}
    </details>
    <div className="mp-chat" role="log" aria-label="Room chat">{client.chat.map((m, i) => <div key={i}><b>{m.name}:</b> {m.text}</div>)}</div>
    <form className="mp-row" onSubmit={e => { e.preventDefault(); if (chat.trim()) { client.send({ v: 1, type: 'chat', text: chat.trim() }); setChat(''); } }}>
      <input aria-label="Chat message" placeholder="Chat with crew…" maxLength={300} value={chat} onChange={e => setChat(e.target.value)} /><button className="btn small" disabled={!client.connected || !chat.trim()}>Send</button>
    </form>
    <button className="btn small" onClick={() => game.set({ multiplayer: null, scene: 'menu' })}>Disconnect to menu</button>
  </aside>;
}
