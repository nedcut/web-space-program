import '../earth-data/register';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Failure, replay, shrink, type Action, type RunStats } from './core';
const arg = (key: string) => {
  const index = process.argv.indexOf(key);
  return index < 0 ? undefined : process.argv[index + 1];
};
const repro = process.argv.includes('--repro') ? JSON.parse(readFileSync(arg('--repro')!, 'utf8')) as { seed: number; actions: Action[] } : null;
const single = process.argv.includes('--seed');
const duration = single || process.argv.includes('--repro') ? 0 : Number(arg('--seconds') || 1200);
if (!Number.isFinite(duration) || duration < 0) throw new Error('Duration must be nonnegative seconds');
const started = Date.now(); let count = 0;
do {
  const seed = repro?.seed ?? (single ? Number(arg('--seed')) : randomBytes(4).readUInt32LE());
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be a uint32 integer');
  console.log(`Starting seed=${seed}`);
  if (duration) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/fuzz/run.ts', '--seed', String(seed)], { encoding: 'utf8', timeout: 90000 });
    process.stdout.write(child.stdout ?? ''); process.stderr.write(child.stderr ?? '');
    if (child.status !== 0) {
      mkdirSync('fuzz-repros', { recursive: true });
      writeFileSync(`fuzz-repros/worker-${seed}.json`, JSON.stringify({ seed, error: String(child.error ?? child.signal ?? child.status), replay: `npx tsx scripts/fuzz/run.ts --seed ${seed}` }));
      process.exitCode = 1; break;
    }
    count++; continue;
  }
  try {
    const s = repro?.seed ?? seed, actions = repro?.actions;
    const stats: RunStats = { frames: 0, railsChecks: 0, saves: 0, evas: 0, docks: 0, nodes: 0, targets: 0, maxRelativeEnergyError: 0, maxWarpJump: 0 };
    const first = replay(s, actions, stats), second = replay(s, actions);
    if (first !== second) throw new Error(`determinism seed=${s}: ${first} != ${second}`);
    count++; if (count % 10 === 0 || !duration) console.log(JSON.stringify({ count, seed: s, hash: first, stats, seconds: (Date.now() - started) / 1000 }));
  } catch (e) {
    mkdirSync('fuzz-repros', { recursive: true });
    if (e instanceof Failure) writeFileSync(`fuzz-repros/${seed}-original.json`, JSON.stringify({ seed: e.seed, step: e.step, reason: e.reason, actions: e.actions }, null, 2));
    const detail = e instanceof Failure ? { seed: e.seed, step: e.step, reason: e.reason, actions: shrink(e), original: e.actions } : { seed, reason: String(e) };
    const file = `fuzz-repros/${seed}.json`; writeFileSync(file, JSON.stringify(detail, null, 2));
    console.error(e); console.error(`Minimized replay: npx tsx scripts/fuzz/run.ts --repro ${file}`); process.exitCode = 1; break;
  }
} while (Date.now() - started < duration * 1000);
console.log(JSON.stringify({ count, elapsedSeconds: (Date.now() - started) / 1000, failed: !!process.exitCode }));
