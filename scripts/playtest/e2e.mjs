// Manual production check: CLI calls, not a replacement Playwright driver.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const session = process.argv[2] || `e2e-${Date.now()}`;
const run = async (...args) => {
  const { stdout } = await exec(process.execPath, ['scripts/playtest/cli.mjs', ...args, '--session', session], { maxBuffer: 4 * 1024 * 1024 });
  console.log(stdout); return stdout;
};
let started = false;
try {
  await run('start'); started = true;
  for (const text of ['New Game', 'Sandbox', 'Start', 'Integration Hall', 'Browse stock vehicles', 'Kestrel Sounding Rocket', 'Launch']) await run('click', text);
  await run('look');
  await run('key', 'z'); await run('key', 'Space'); await run('key', 'Shift', '--hold', '5');
  await run('look'); await run('key', 'm'); await run('wait', '0.1'); await run('look');
  await run('key', 'm'); await run('wait', '0.1'); await run('look');
  const actions = (await readFile(`.playtest/${session}/actions.jsonl`, 'utf8')).trim().split('\n').map(JSON.parse);
  const flight = actions.find(a => a.command === 'look' && a.altitudeAGL > 10);
  assert.ok(flight, 'ascent above 10m AGL');
  assert.ok(actions.some(a => a.scene === 'map'), 'map opens');
  assert.equal(actions.at(-1).scene, 'flight');
  assert.ok(actions.every(a => a.ok && !a.errors.length), 'no action/browser/GPU errors');
  console.log(`PASS ${session}`);
} finally { if (started) await run('stop'); }
