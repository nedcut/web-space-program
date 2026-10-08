import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PART_DEFS } from '../src/data/parts';
import { TECH_NODES } from '../src/data/technology';
import { STOCK_CRAFTS } from '../src/editor/stockCrafts';
import { CRAFT_TYPE_LABELS } from '../src/editor/craftTypeLabels';
import { BANNED_NAMES } from './forbiddenTerms';

const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css|html|json)$/.test(name)) out.push(p);
  }
  return out;
}

/** Drops block comments, whole-line comments and trailing ` // ...` comments; developer notes may mention other games. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, '')).join('\n');
}

describe('original names', () => {
  const files = [...walk(join(ROOT, 'src')), join(ROOT, 'index.html'), ...walk(join(ROOT, 'public'))].filter(f => !/src\/data\/(smallBodies|bodies)\.ts$/.test(f) && !f.endsWith('.json'));

  it('no source file a player can read uses another game\'s names', () => {
    const hits: string[] = [];
    for (const f of files) {
      const lines = stripComments(readFileSync(f, 'utf8')).split('\n');
      lines.forEach((l, i) => { const m = BANNED_NAMES.exec(l); if (m) hits.push(`${relative(ROOT, f)}:${i + 1} "${m[0]}"`); });
    }
    expect(hits).toEqual([]);
  });

  it('VAB/SPH appear only as stored craft-type ids, never as UI text', () => {
    const hits: string[] = [];
    for (const f of files) {
      const lines = stripComments(readFileSync(f, 'utf8')).split('\n');
      lines.forEach((l, i) => { for (const m of l.matchAll(/\b(VAB|SPH)\b/g)) { const at = m.index ?? 0; if (!(l[at - 1] === "'" && l[at + 3] === "'")) hits.push(`${relative(ROOT, f)}:${i + 1}`); } });
    }
    expect(hits).toEqual([]);
  });

  it('data strings (parts, tech tree, stock vehicles, building modes) are clean', () => {
    const strings = [
      ...PART_DEFS.flatMap(p => [p.name, p.description, p.manufacturer]),
      ...TECH_NODES.map(t => t.name),
      ...Object.values(CRAFT_TYPE_LABELS).flatMap(l => [l.short, l.long, l.hint]),
      ...STOCK_CRAFTS.flatMap(s => { const c = s.build(); return [s.name, s.blurb, c.name, (c as { description?: string }).description ?? '']; }),
    ];
    for (const s of strings) expect(s).not.toMatch(BANNED_NAMES);
  });
});
