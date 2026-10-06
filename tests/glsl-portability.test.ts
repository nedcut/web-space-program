import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GLSL constructs whose results are undefined by the spec and differ between GPU backends.
 * Apple's Metal backend (every Mac browser) extrapolates them where ANGLE/D3D happens to clamp —
 * a reversed smoothstep in the sun-glare ghosts flooded Retina MacBooks with green light.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sources(join(__dirname, '../src/render')).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('GLSL portability', () => {
  it('has no smoothstep with literal edge0 >= edge1', () => {
    const bad: string[] = [];
    for (const { path, text } of files) {
      for (const m of text.matchAll(/(?<![.\w])smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
        if (+m[1] >= +m[2]) bad.push(`${path}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('squares explicitly instead of pow(x, 2.0) (undefined for negative x)', () => {
    const bad: string[] = [];
    for (const { path, text } of files) {
      for (const m of text.matchAll(/(?<![.\w])pow\(([^()]|\([^()]*\))*,\s*2\.0\s*\)/g)) bad.push(`${path}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });
});
