import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const phase = process.argv[2] ?? 'before';
const ready = `await new Promise(resolve => { const timer = setInterval(() => { if (window.__flight && !document.querySelector('.loading-screen')) { clearInterval(timer); resolve(); } }, 250); });`;
const cases = [
 ['settings', '?scene=menu', `document.querySelectorAll('button').forEach(b => { if (b.textContent === 'Settings') b.click(); });`],
 ['flight', '?flight=stock-meridian', ready],
 ['map', '?flight=stock-meridian', ready + `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true }));`],
 ['pause', '?flight=stock-meridian', ready + `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));`],
 ['missions-career', '?scene=menu', `const { game } = await import('/src/game/store.ts'); const { World } = await import('/src/game/world.ts'); const { Universe } = await import('/src/game/universe.ts'); const { PART_CATALOG } = await import('/src/data/parts.ts'); const { saveProgram } = await import('/src/game/program.ts'); const w = new World(new Universe('standard'), PART_CATALOG, game.get().ut, 'career'); saveProgram(w); game.set({ mode: 'career', scene: 'missions' });`],
];
for (const [width,height] of [[1366,768],[1920,1080]]) for (const [name,query,setup] of cases) {
 if (process.env.SHOT_RESUME && existsSync(`docs/screenshots/ui-polish/${phase}/${name}-${width}.png`)) continue;
 const r=spawnSync(process.execPath,['scripts/shot.mjs',`http://localhost:5200/${query}`,`docs/screenshots/ui-polish/${phase}/${name}-${width}.png`,'2500',`(async () => { ${setup} })()`],{env:{...process.env,SHOT_HIDE_HELP:'1',SHOT_WIDTH:String(width),SHOT_HEIGHT:String(height)},encoding:'utf8'});
 console.log(`${name} ${width}: ${r.status}\n${r.stdout}${r.stderr}`); if(r.status) process.exit(r.status);
}
