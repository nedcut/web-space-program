// Reproducible scene review. Each capture uses the repository SwiftShader helper.
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
const phase = process.argv[2] ?? 'before';
const scenes = ['menu', 'spaceCenter', 'editor', 'flight', 'tracking', 'research', 'missions', 'training', 'pedia', 'scenarios', 'flightlog'];
for (const [width, height] of [[1366, 768], [1920, 1080]]) {
  for (const scene of scenes) {
    const dir = `docs/screenshots/ui-polish/${phase}`;
    mkdirSync(dir, { recursive: true });
    if (process.env.SHOT_RESUME && existsSync(`${dir}/${scene}-${width}.png`)) continue;
    if (process.env.SHOT_SKIP_FLIGHT && scene === 'flight') continue;
    const query = scene === 'flight' ? '?flight=stock-meridian' : `?scene=${scene}`;
    const setup = scene === 'flight' ? "new Promise(resolve => { const timer = setInterval(() => { if (window.__flight && !document.querySelector('.loading-screen')) { clearInterval(timer); resolve(); } }, 250); })" : '';
    const result = spawnSync(process.execPath, ['scripts/shot.mjs', `http://localhost:5200/${query}`, `${dir}/${scene}-${width}.png`, '2500', setup], { env: { ...process.env,SHOT_HIDE_HELP:'1', SHOT_WIDTH: String(width), SHOT_HEIGHT: String(height) }, encoding: 'utf8' });
    console.log(`${phase} ${scene} ${width}: ${result.status}\n${result.stdout}${result.stderr}`);
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
