import { once } from 'node:events';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { createLanServer } from '../server/server';
import { decodeServer, encode, type ClientMessage, type ServerMessage } from '../src/net/protocol';
import { buildSoundingRocket } from '../src/editor/stockCrafts';

it('serves two WebSocket clients through join, launch, ownership, chat and disconnect', async () => {
  const host = createLanServer(0, '127.0.0.1');
  const sockets: WebSocket[] = [];
  try {
    await once(host.server, 'listening');
    const address = host.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing TCP address');
    const connect = async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
      sockets.push(socket);
      const messages: ServerMessage[] = [];
      socket.on('message', raw => messages.push(decodeServer(raw.toString())));
      await once(socket, 'open');
      return {
        messages,
        send: (m: ClientMessage) => socket.send(encode(m)),
        wait: async (predicate: (m: ServerMessage) => boolean) => {
          await expect.poll(() => messages.some(predicate), { timeout: 3000, interval: 10 }).toBe(true);
          return messages.find(predicate)!;
        },
      };
    };
    const alice = await connect();
    alice.send({ v: 1, type: 'join', name: 'Alice', room: '' });
    const welcome = await alice.wait(m => m.type === 'welcome');
    if (welcome.type !== 'welcome') throw new Error('Missing welcome');
    const bob = await connect();
    bob.send({ v: 1, type: 'join', name: 'Bob', room: welcome.room });
    await bob.wait(m => m.type === 'snapshot' && m.room.players.length === 2);
    alice.send({ v: 1, type: 'launch', craft: buildSoundingRocket(), site: 'pad' });
    const launched = await bob.wait(m => m.type === 'snapshot' && m.world.vessels.length === 1);
    if (launched.type !== 'snapshot') throw new Error('Missing launch snapshot');
    bob.send({ v: 1, type: 'claim', vesselId: launched.world.vessels[0].state.id });
    await bob.wait(m => m.type === 'error' && m.message === 'Vessel already controlled');
    alice.send({ v: 1, type: 'chat', text: 'Ready for launch' });
    await bob.wait(m => m.type === 'event' && m.event.type === 'chat' && m.event.text === 'Ready for launch');
    await bob.wait(m => m.type === 'delta' && m.tick >= 5);
    alice.send({ v: 1, type: 'leave' });
    await bob.wait(m => m.type === 'snapshot' && m.room.players.length === 1 && m.room.players[0].name === 'Bob');
    bob.send({ v: 1, type: 'claim', vesselId: launched.world.vessels[0].state.id });
    await bob.wait(m => m.type === 'snapshot' && m.room.players.some(p => p.name === 'Bob' && p.vesselId !== null));
  } finally {
    for (const socket of sockets) socket.terminate();
    await host.close();
  }
}, 10_000);
