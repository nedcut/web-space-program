import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDSHAKE_TIMEOUT_MS, MultiplayerClient, SILENCE_TIMEOUT_MS } from '../src/net/client';
import { encode, type ClientMessage, type ServerMessage } from '../src/net/protocol';
import { serializeWorld } from '../src/net/snapshots';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { neutralInput } from '../src/sim/vessel';

/** In-memory WebSocket: the test plays the server. */
class FakeSocket {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  static latest: FakeSocket;
  readyState = FakeSocket.CONNECTING;
  sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() { FakeSocket.latest = this; }
  send(raw: string) { this.sent.push(JSON.parse(raw) as ClientMessage); }
  close() { if (this.readyState === FakeSocket.CLOSED) return; this.readyState = FakeSocket.CLOSED; queueMicrotask(() => this.onclose?.()); }
  open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  serve(m: ServerMessage) { this.onmessage?.({ data: encode(m) }); }
  raw(data: string) { this.onmessage?.({ data }); }
}
const snapshot = (tick = 1): ServerMessage => ({ v: 1, type: 'snapshot', tick, world: serializeWorld(new World(new Universe('standard'), PART_CATALOG, 0)), room: { players: [], rate: 1, requestedRate: 1, heldBy: [], queue: [] } });
const join = () => new MultiplayerClient({ url: 'ws://127.0.0.1:8787', room: '', name: 'Pilot' });

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'queueMicrotask', 'performance'] }); vi.stubGlobal('WebSocket', FakeSocket); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('multiplayer connection status', () => {
  it('times out a server that accepts the socket but never sends the room', () => {
    const client = join();
    FakeSocket.latest.open();
    vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS - 1);
    expect(client.status).toBe('Connecting…');
    vi.advanceTimersByTime(1);
    expect(client.state).toBe('lost');
    expect(client.status).toMatch(/Connection lost/);
    expect(client.error).toMatch(/No answer from the server/);
    expect(FakeSocket.latest.sent.at(-1)?.type).toBe('leave');
    expect(FakeSocket.latest.readyState).toBe(FakeSocket.CLOSED);
  });

  it('the first room snapshot connects and stops the handshake timer', () => {
    const client = join();
    FakeSocket.latest.open();
    FakeSocket.latest.serve(snapshot());
    expect(client.status).toBe('Connected');
    expect(client.connected).toBe(true);
    vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS * 2);
    expect(client.status).toBe('Connected');
  });

  it('reports a silent or misbehaving server as a lost connection, not as the player leaving', async () => {
    const silent = join();
    FakeSocket.latest.open(); FakeSocket.latest.serve(snapshot());
    vi.advanceTimersByTime(SILENCE_TIMEOUT_MS + 1);
    silent.update(0.016, neutralInput());
    await vi.runAllTimersAsync();
    expect(silent.status).toMatch(/Connection lost/);
    expect(silent.error).toBe('Server stopped responding');

    const garbled = join();
    FakeSocket.latest.open(); FakeSocket.latest.raw('not json');
    await vi.runAllTimersAsync();
    expect(garbled.status).toMatch(/Connection lost/);
    expect(garbled.error).toMatch(/^Protocol error/);
  });

  it('keeps the first failure reason and reads "Disconnected" only when the player leaves', async () => {
    const unreachable = join();
    FakeSocket.latest.onerror?.(); FakeSocket.latest.onclose?.();
    expect(unreachable.status).toMatch(/Connection lost/);
    expect(unreachable.error).toMatch(/Cannot reach server/);

    const left = join();
    FakeSocket.latest.open(); FakeSocket.latest.serve(snapshot());
    left.close();
    await vi.runAllTimersAsync();
    expect(left.status).toBe('Disconnected');
    expect(left.connected).toBe(false);
    expect(FakeSocket.latest.sent.at(-1)?.type).toBe('leave');
  });
});
