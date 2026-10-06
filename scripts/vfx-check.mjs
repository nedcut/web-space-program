// Run with Windows node; WSP_PLAYWRIGHT_PACKAGE may override the installed driver package.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(process.env.WSP_PLAYWRIGHT_PACKAGE || 'C:/wsp-tools/drv/package.json');
const { chromium } = require('playwright-core');
const [base = 'http://localhost:5331', label = 'before', out = 'C:/wsp-tools/shots'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
for(const c of browser.contexts()) { c.on('page',p=>p.on('dialog',()=>{})); for(const p of c.pages()) p.on('dialog',()=>{}); }
const context = await browser.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2 });
await context.addInitScript(() => {
 localStorage.setItem('wsp.settings.v1', JSON.stringify({quality:'medium',graphicsProfile:1,adaptiveQuality:false,autoSaveInterval:0,showFps:true}));
 localStorage.setItem('wsp.help.seen.v1','1');
});
const results = {};
try {
for (const name of (process.argv[5] || process.env.VFX_SCENES || 'liftoff,maxq,vacuum,moon,reentry,explosion').split(',')) {
 const page = await context.newPage(); await page.bringToFront(); const errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.error(name,String(e));});
 page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
 await page.goto(`${base}/?flight=${name==='moon'?'stock-bedrock':'stock-meridian'}${name==='vacuum'?'&scenario=orbit':name==='reentry'?'&scenario=reentry':name==='moon'?'&scenario=moon':''}`);
 await page.waitForFunction(()=>window.__flight?.warmup==='done', null, {timeout:90000});
 await page.waitForTimeout(9000);
 await page.evaluate(async name=>{
  const f=window.__flight, w=f.world;
  if(name==='live') {f.input.state.throttle=1; f.stage(); f.cam.mode='chase'; f.cam.distance=36; return;}
  f.paused=true;
  if(name==='vacuum'||name==='reentry') {
    const {neutralInput}=await import('/src/sim/vessel/runtime.ts');
    for(let i=0;i<6 && w.active.state.parts.filter(p=>p.engine).length>(name==='vacuum'?1:0);i++) w.tick(.02,neutralInput({stage:true}));
    for(const id of w.vessels.keys()) if(id!==w.activeId) w.vessels.delete(id);
  }
  const v=w.active.state;
  const T={Vector3:f.cam.camera.position.constructor,Quaternion:f.cam.camera.quaternion.constructor};
  f.paused=true; f.cam.mode=name==='liftoff'?'chase':'auto'; f.cam.distance=36; f.cam.pitch=.18;
  w.renderHistory.invalidate(); w.active.mode='physics'; w.active.fixed=undefined; v.situation='flying';
  const bs=w.universe.ephem.getBodyState(w.active.body,w.ut);
  const up=new T.Vector3().copy(v.position).sub(bs.position).normalize();
  if(name==='liftoff'||name==='maxq'||name==='moon'||name==='reentry') {
   const h=name==='moon'?8:name==='liftoff'?32:name==='reentry'?20000:4500;
   const info=w.universe.surfaceInfo(w.active.body,v.position,w.ut);
   v.position.x+=up.x*(h-info.heightAboveTerrain); v.position.y+=up.y*(h-info.heightAboveTerrain); v.position.z+=up.z*(h-info.heightAboveTerrain);
   if(name!=='reentry') v.orientation=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),up);
  }
  if(name==='maxq') {const av=w.surfaceVelocity(w.active);v.velocity.x+=up.x*320-av.x;v.velocity.y+=up.y*320-av.y;v.velocity.z+=up.z*320-av.z;}
  if(name!=='reentry'&&name!=='explosion') {
   const engines=v.parts.filter(p=>p.engine); const bottom=Math.min(...engines.map(p=>p.position.y)); for(const p of engines) {const on=p.position.y<bottom+2; p.engine.ignited=on; p.engine.throttle=on?1:0; p.engine.thrust=on?150000:0;}
  }
  // Deterministic simulation-time particle pre-roll; keeps the selected scene fixed for A/B.
  const air=w.surfaceVelocity(w.active), density=name==='moon'||name==='vacuum'?0:1;
  const altitude=name==='moon'?8:name==='maxq'?4500:name==='vacuum'?150000:name==='liftoff'?32:12;
  f.effects.lastUt=undefined;
  if(name==='explosion') f.effects.burst(v.position,false,{x:0,y:0,z:0});
  for(let i=0;i<(name==='explosion'?12:100);i++) f.effects.update({...v,velocity:air},v.position,bs.position,{x:0,y:0,z:0},w.active.body,altitude,density,0,air,.02,1840,w.ut+i*.02,w.universe.body(w.active.body).surface.colors);
  f.effects.lastUt=w.ut; // pause without rewinding the effect clock
  // Fixed side/chase framing; render coordinates remain relative to the vessel.
  const side=new T.Vector3(0,0,1).cross(up).normalize();
  f.updateCamera=()=>{};
  f.cam.camera.position.copy(side).multiplyScalar(name==='moon'?18:name==='reentry'?9:name==='vacuum'?18:30).addScaledVector(up,8);
  f.cam.camera.up.copy(up); f.cam.camera.lookAt(new T.Vector3().addScaledVector(up,-3));
  f.cam.camera.updateMatrixWorld();
 },name);
 await page.waitForTimeout(name==='live'?7000:2000);
 if(name==='live') await page.evaluate(()=>{window.__flight.paused=true;});
 await page.addStyleTag({content:'.overlay.hud, .situation-title { visibility:hidden!important; }'});
 await page.screenshot({path:`${out}/${label}-${name}.png`});
 results[name]=label==='before'?{baseline:true}:await page.evaluate(async()=>{
  const f=window.__flight,p=f.pipeline, r=p.renderer, full=p.gpuMs;
  const parentTimer=p.gpuTimer, records=[];
  // Use the production timer around each effect draw. Queries cannot nest: suspend only the
  // whole-frame query while sampling. Every engine object gets its own timer, then costs sum.
  p.gpuTimer=null;
  f.scene.traverse(o=>{
    const u=o.material?.uniforms;
    const family=u?.uCoreAmp||u?.uHaze?'plumes':u?.groundOffset?'particles':u?.uWake?'plasma':o.name==='transonic-vapour'?'condensation':null;
    if(!family)return;
    const timer=parentTimer.constructor.create(r.getContext());
    const before=o.onBeforeRender, after=o.onAfterRender;
    const rec={o,timer,family,before,after,samples:[]}; records.push(rec);
    o.onBeforeRender=function(...args){before.apply(this,args);timer.begin();};
    o.onAfterRender=function(...args){timer.end();after.apply(this,args);};
  });
  try {
    for(let i=0;i<150;i++) {
      await new Promise(requestAnimationFrame);
      for(const rec of records) {const ms=rec.timer.poll();if(i>30 && ms!==undefined)rec.samples.push(ms);}
    }
    const draws=records.map(rec=>({family:rec.family,samples:rec.samples.length,median:rec.samples.sort((a,b)=>a-b)[rec.samples.length>>1]??0}));
    const cost={}; for(const d of draws)cost[d.family]=(cost[d.family]??0)+d.median;
    return {gpu:p.gpuName,buffer:[r.domElement.width,r.domElement.height],full,cost,draws};
  } finally {
    for(const rec of records){rec.o.onBeforeRender=rec.before;rec.o.onAfterRender=rec.after;rec.timer.dispose();}
    p.gpuTimer=parentTimer;
  }
 });
 results[name].errors=errors;
 console.log(name,JSON.stringify(results[name])); writeFileSync(`${out}/${label}-vfx.json`,JSON.stringify(results,null,2)); await page.close();
}
writeFileSync(`${out}/${label}-vfx.json`,JSON.stringify(results,null,2));
} finally { await context.close(); await browser.close(); }
