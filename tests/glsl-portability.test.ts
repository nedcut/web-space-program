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

  it('injects no new vector varyings into three built-in materials outside the reviewed patches', () => {
    // WebGL 2 only guarantees 15 varying vectors, and that is all Firefox reports under resistFingerprinting
    // (some mobile GPUs too). Standard/physical materials with maps, vertex colours, shadows and log depth are
    // already near it: a vec3 added to every part's thermal variant made those programs fail to link.
    // Scalars pack into spare components; vector additions need checking at the 15-vector limit
    // (node scripts/browser-smoke.mjs --browsers firefox --quality medium --firefox-prefs '{"privacy.resistFingerprinting":true}').
    const reviewed = new Map([
      ['render/site/aerial.ts', 1], // launch-site materials only
      ['render/site/LaunchSite.ts', 1],
      ['render/map/OrbitStyle.ts', 2], // Line2 material, not a lit mesh material
    ]);
    const found = new Map<string, number>();
    for (const { path, text } of files) {
      if (!text.includes('onBeforeCompile')) continue;
      const key = path.replace(/\\/g, '/').split('/src/')[1];
      const vectors = new Set([...text.matchAll(/varying\s+(?:highp\s+|mediump\s+)?(?:vec[234]|mat[234])\s+(\w+)/g)].map((m) => m[1]));
      if (vectors.size) found.set(key, vectors.size);
    }
    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(reviewed));
  });
});
