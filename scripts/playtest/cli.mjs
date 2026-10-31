import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, readActions } from './protocol.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function request(dir, action) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: path.join(dir, 'control.sock'), path: '/', method: 'POST' }, res => {
      let body = ''; res.on('data', b => body += b); res.on('end', () => {
        try { const result = JSON.parse(body); if (!result.ok) reject(new Error(result.output)); else resolve(result.output); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.end(JSON.stringify(action));
  });
}
async function start(dir) {
  if (Buffer.byteLength(path.join(dir, 'control.sock')) > 103) throw new Error('Session socket path is too long; choose a shorter session name or checkout path');
  await mkdir(path.dirname(dir), { recursive: true });
  try { await mkdir(dir); } catch { throw new Error(`Session directory exists: ${dir}. Stop it first; keep or rename old evidence before reusing its name.`); }
  const log = await open(path.join(dir, 'daemon.log'), 'a');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url)), dir], { cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd] });
  child.unref(); await log.close();
  for (let n = 0; n < 900; n++) {
    try { return await readFile(path.join(dir, 'ready'), 'utf8'); } catch { /* startup */ }
    try { process.kill(child.pid, 0); } catch { throw new Error(await readFile(path.join(dir, 'daemon.log'), 'utf8')); }
    await delay(100);
  }
  process.kill(child.pid, 'SIGTERM');
  throw new Error(`Startup timed out; inspect ${dir}/daemon.log`);
}
async function main() {
  const action = parse(process.argv.slice(2));
  const dir = path.join(root, '.playtest', action.options.session);
  if (action.command === 'start') return console.log(await start(dir));
  if (action.command === 'replay') {
    const actions = readActions(await readFile(action.args[0], 'utf8'));
    console.log(await start(dir));
    // --until refers to the original recorded step, including observations and failures.
    for (const a of actions) {
      if (action.options.until && a.step > Number(action.options.until)) break;
      if (['start', 'stop', 'replay'].includes(a.command)) continue;
      console.log(`REPLAY step ${a.step}: ${a.command} ${a.args.join(' ')}`);
      try { console.log(await request(dir, { command: a.command, args: a.args, options: a.options ?? {} })); }
      catch (error) { if (a.ok !== false) throw error; console.log(`Expected recorded failure: ${error.message}`); }
    }
    return console.log(`Replay frozen at final step. Inspect with --session ${action.options.session} look; stop when done.`);
  }
  console.log(await request(dir, action));
  if (action.command === 'stop') {
    await rm(path.join(dir, 'ready'), { force: true });
    await writeFile(path.join(dir, 'stopped'), new Date().toISOString());
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
