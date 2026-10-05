import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { Room } from './room';
import { decodeClient, encode, MAX_MESSAGE_BYTES } from '../src/net/protocol';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const rooms = new Map<string, Room>();
const server = new WebSocketServer({ port, host, maxPayload: MAX_MESSAGE_BYTES });
server.on('connection', socket => {
  let room: Room | undefined, playerId: string | undefined;
  let alive = true, messages = 0;
  const joinedDeadline = setTimeout(() => { if (!room) socket.close(1008, 'Join timeout'); }, 10_000);
  const heartbeat = setInterval(() => {
    messages = 0;
    if (!alive) return socket.terminate();
    alive = false;
    socket.ping();
  }, 10_000);
  socket.on('pong', () => { alive = true; });
  const send = (raw: string) => {
    if (socket.bufferedAmount > 2_000_000) return socket.close(1013, 'Client too slow');
    if (socket.readyState === WebSocket.OPEN) socket.send(raw);
  };
  socket.on('message', (data, binary) => {
    if (binary || ++messages > 1200) return socket.close(1008, 'Message limit');
    try {
      const raw = data.toString();
      if (room && playerId) {
        room.receive(playerId, raw);
        if (!room.players.has(playerId)) socket.close(1000, 'Left room');
        return;
      }
      const m = decodeClient(raw);
      if (m.type !== 'join') throw new Error('Join first');
      if (m.room) {
        room = rooms.get(m.room);
        if (!room) throw new Error('Room not found; leave code empty to host a new room');
      } else {
        if (rooms.size >= 32) throw new Error('Room limit reached');
        let code: string;
        do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
        room = new Room(code);
        rooms.set(code, room);
      }
      playerId = room.join(m.name, send);
      clearTimeout(joinedDeadline);
    } catch (e) {
      send(encode({ v: 1, type: 'error', message: (e as Error).message }));
      if (!playerId) { room = undefined; socket.close(1008, 'Join failed'); }
    }
  });
  socket.on('error', () => socket.terminate());
  socket.on('close', () => { clearTimeout(joinedDeadline); clearInterval(heartbeat); if (playerId) room?.leave(playerId); });
});
// Single fixed 20 ms step; overload slows shared simulation rather than skipping physics.
const timer = setInterval(() => { for (const room of rooms.values()) room.tick(); }, 20);
const cleanup = setInterval(() => { for (const [code, room] of rooms) if (!room.players.size) rooms.delete(code); }, 60_000);
server.on('listening', () => console.log(`Experimental WSP LAN server: ws://${host}:${port} (4 players/room, memory only)`));
server.on('error', e => { console.error(e); clearInterval(timer); clearInterval(cleanup); process.exitCode = 1; });
function stop() { clearInterval(timer); clearInterval(cleanup); for (const s of server.clients) s.terminate(); server.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
