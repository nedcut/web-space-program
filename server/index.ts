import '../scripts/earth-data/register';
import { createLanServer } from './server';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const { server, close } = createLanServer(port, host);
server.on('listening', () => console.log(`Experimental WSP LAN server: ws://${host}:${port} (4 players/room, memory only)`));
server.on('error', error => { console.error(error); process.exitCode = 1; });
const stop = () => { void close().catch(error => { console.error(error); process.exitCode = 1; }); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
