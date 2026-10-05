import { spawnSync } from 'node:child_process';
const phase=process.argv[2]??'after';
// For historical baseline captures, archive the starting revision inside this worktree.
const base=phase==='before'?'/.ui-baseline':'';
const report=`const {game,DEFAULT_START_UT}=await import('${base}/src/game/store.ts');
const {World}=await import('${base}/src/game/world.ts');const {Universe}=await import('${base}/src/game/universe.ts');
const {PART_CATALOG}=await import('${base}/src/data/parts.ts');const {buildOrbiter}=await import('${base}/src/editor/stockCrafts.ts');
const {neutralInput}=await import('${base}/src/sim/vessel/index.ts');const {saveProgram}=await import('${base}/src/game/program.ts');
const w=new World(new Universe('standard'),PART_CATALOG,DEFAULT_START_UT);w.launch(buildOrbiter());
for(let i=0;i<600;i++)w.tick(.02,neutralInput({throttle:1,stage:i===0,sas:'stabilityAssist'}));
w.recordFlight(w.active,w.ut,true);saveProgram(w);game.set({scene:'flightlog'});`;
const loading=`const {game}=await import('${base}/src/game/store.ts');const {STOCK_CRAFTS}=await import('${base}/src/editor/stockCrafts.ts');game.set({craft:STOCK_CRAFTS[1].build(),scene:'flight',launchPending:true});
await new Promise(resolve=>{const id=setInterval(()=>{if(document.querySelector('.loading-screen')){clearInterval(id);resolve();}},10);});`;
for(const [width,height] of [[1366,768],[1920,1080]]) for(const [name,setup,wait] of [['report',report,'1000'],['loading',loading,'0']]) {
 if (process.env.SHOT_ONLY && process.env.SHOT_ONLY !== name) continue;
 const r=spawnSync(process.execPath,['scripts/shot.mjs',`http://localhost:5200${base}/?scene=menu`,`docs/screenshots/ui-polish/${phase}/${name}-${width}.png`,wait,`(async()=>{${setup}})()`],{env:{...process.env,SHOT_HIDE_HELP:'1',SHOT_WIDTH:String(width),SHOT_HEIGHT:String(height)},encoding:'utf8'});
 console.log(`${phase} ${name} ${width}: ${r.status}\n${r.stdout}${r.stderr}`);if(r.status)process.exit(r.status);
}
