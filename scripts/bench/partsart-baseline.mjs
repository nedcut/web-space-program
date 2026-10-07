// Run from the partsart worktree before starting the capture driver. Keeps main's
// unrelated changes identical in both fixtures; restores only this branch's art.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, '.tmp/partsart-baseline');
const base = 'b6ec2204';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
mkdirSync(out, { recursive: true });
rmSync(resolve(out, 'src'), { recursive: true, force: true });
cpSync(resolve(root, 'src'), resolve(out, 'src'), { recursive: true });
const changed = git(['diff', '--name-only', base, '8a92e965', '--', 'src']).trim().split('\n');
const original = new Set(git(['ls-tree', '-r', '--name-only', base, '--', 'src']).trim().split('\n'));
for (const path of changed) {
  if (original.has(path)) writeFileSync(resolve(out, path), git(['show', `${base}:${path}`]));
  else rmSync(resolve(out, path), { force: true });
}
for (const path of ['index.html', 'parts-preview.html']) {
  writeFileSync(resolve(out, path), readFileSync(resolve(root, path), 'utf8').replaceAll('src="/src/', 'src="/.tmp/partsart-baseline/src/'));
}
console.log('Baseline ready at http://localhost:5333/.tmp/partsart-baseline/');
