// Summarises interleaved gpu-passes A/B runs (ab-<name>-<A|B>-<case>-r<n>.json) as medians per case and side.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [name, dir, out] = process.argv.slice(2);
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '–');
const runs = {};
for (const file of readdirSync(dir)) {
  const m = file.match(new RegExp(`^ab-${name}-([AB])-(\\w+)-r(\\d+)\\.json$`));
  if (!m) continue;
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const c = data.cases[m[2]]; if (!c || c.error) continue;
  ((runs[m[2]] ??= { A: [], B: [] })[m[1]]).push(c);
}
const rows = [];
let md = `# GPU A/B: ${name}\n\nInterleaved runs (A then B per repetition), medians. fenced = GPU elapsed per frame over 20 back-to-back renders (timer query); loop GPU = pipeline's smoothed timer while playing; passes = elapsed queries per composer pass in the running loop.\n\n| Case | n | fenced GPU ms A → B | Δ | loop GPU ms | loop fps | scene pass | post (bloom+tonemap+AA+upscale) | canvas / internal ratio | triangles |\n|---|---:|---:|---:|---:|---:|---:|---:|---|---:|\n`;
for (const [c, { A, B }] of Object.entries(runs)) {
  const g = (arr, f) => med(arr.map(f));
  const post = (x) => Object.entries(x.passes ?? {}).filter(([k]) => k !== 'scene').reduce((s, [, v]) => s + v, 0);
  const fa = g(A, (x) => x.fenced), fb = g(B, (x) => x.fenced);
  rows.push({ c, fa, fb });
  md += `| ${c} | ${A.length}/${B.length} | ${f2(fa)} → ${f2(fb)} | ${Number.isFinite(fa) && Number.isFinite(fb) ? (((fb - fa) / fa) * 100).toFixed(0) + ' %' : '–'} | ${f2(g(A, (x) => x.loopGpuMs))} → ${f2(g(B, (x) => x.loopGpuMs))} | ${f2(g(A, (x) => x.loopFps))} → ${f2(g(B, (x) => x.loopFps))} | ${f2(g(A, (x) => x.passes?.scene))} → ${f2(g(B, (x) => x.passes?.scene))} | ${f2(g(A, post))} → ${f2(g(B, post))} | ${A[0]?.canvas?.join('×')} / ${A[0]?.pixelRatio} → ${B[0]?.canvas?.join('×')} / ${B[0]?.pixelRatio} | ${g(A, (x) => x.stats?.triangles ?? NaN)} → ${g(B, (x) => x.stats?.triangles ?? NaN)} |\n`;
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `ab-${name}.md`), md);
writeFileSync(join(out, `ab-${name}.json`), JSON.stringify(runs, null, 1));
console.log(md);
