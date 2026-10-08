// Windows Chrome quiet-impact CPU profile. From WSL, hold /tmp/wsp-gpu.lock.
// node.exe wp1-impact-profile.mjs <base> [label] [C:/wsp-tools/shots/wp1] [cpu|trace|quiet]
// cpu: 200 us V8 samples (slows the page; attribution only). trace: Chrome timeline trace of the renderer (native
// work inside long tasks). quiet: no instrumentation beyond the long-task observer and rAF gaps.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const [base,label='after',out='C:/wsp-tools/shots/wp1',mode='cpu'] = process.argv.slice(2);
mkdirSync(out,{recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:9333');
const context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:2,serviceWorkers:'block'});
await context.addInitScript(()=>{
  localStorage.setItem('wsp.help.seen.v1','1');
  localStorage.setItem('wsp.settings.v1',JSON.stringify({quality:'medium',graphicsProfile:99,adaptiveQuality:false,autoSaveInterval:0,masterVolume:.7,sfxVolume:1,musicVolume:0,flightHints:false,cameraShake:1}));
});
const page=await context.newPage(), errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const report={label,base,mode,errors};
async function load(query='') {
  await page.goto(`${base}/?flight=stock-meridian${query}`);
  await page.waitForFunction(()=>window.__flight && !document.querySelector('.loading-screen'),null,{timeout:120000});
  await page.bringToFront(); await page.mouse.click(10,10); await page.waitForTimeout(3000);
  await page.evaluate(()=>{
    window.__wp1={lost:null,bar:null,tasks:[],gaps:[]};
    let prev=performance.now();const tick=t=>{if(t-prev>20)window.__wp1.gaps.push({start:prev,duration:+(t-prev).toFixed(1)});prev=t;requestAnimationFrame(tick);};requestAnimationFrame(tick);
    new PerformanceObserver(list=>window.__wp1.tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask'});
    const f=window.__flight, old=f.onActiveLost;
    f.onActiveLost=()=>{window.__wp1.lost=performance.now(); old?.();};
    new MutationObserver(()=>{if(window.__wp1.bar===null && document.querySelector('.flight-ended-bar'))window.__wp1.bar=performance.now();}).observe(document.body,{childList:true,subtree:true});
  });
}
async function prepareCrash() {
  await page.evaluate(()=>{
    const f=window.__flight,w=f.world,v=w.active.state,T={Vector3:f.cam.camera.position.constructor,Quaternion:f.cam.camera.quaternion.constructor};
    f.paused=true; f.cam.distance=48;
    const bs=w.universe.ephem.getBodyState(w.active.body,w.ut),up=new T.Vector3().copy(v.position).sub(bs.position).normalize();
    const air=w.surfaceVelocity(w.active), agl=w.universe.surfaceInfo(w.active.body,v.position,w.ut).heightAboveTerrain;
    v.position.x+=up.x*(40-agl);v.position.y+=up.y*(40-agl);v.position.z+=up.z*(40-agl);
    v.orientation=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),up.clone().negate());
    v.velocity.x-=air.x+up.x*120;v.velocity.y-=air.y+up.y*120;v.velocity.z-=air.z+up.z*120;
    w.active.mode='physics';w.active.fixed=undefined;w.active.holdDown=undefined;v.situation='flying';w.renderHistory.invalidate();
  });
}
try {
  await load();await prepareCrash();await page.waitForTimeout(400);
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  if(mode==='cpu'){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});await cdp.send('Profiler.start');}
  if(mode==='trace')await cdp.send('Tracing.start',{transferMode:'ReturnAsStream',traceConfig:{recordMode:'recordAsMuchAsPossible',includedCategories:['toplevel','devtools.timeline','disabled-by-default-devtools.timeline','blink.user_timing','v8.execute','gpu','blink','cc','viz'],excludedCategories:['*']}});
  report.metrics=(await cdp.send('Performance.getMetrics')).metrics;
  await page.evaluate(()=>{window.__wp1.tasks=[];window.__wp1.gaps=[];window.__flight.paused=false;});await page.waitForTimeout(280);
  report.fragments=await page.evaluate(()=>{
    const f=window.__flight,camera=f.cam.camera,V=camera.position.constructor,point=new V();let visible=0;
    for(const mesh of f.effects.debris.root.children){
      if(!mesh.visible)continue;point.copy(mesh.position).applyMatrix4(mesh.parent.matrixWorld);
      const range=point.distanceTo(camera.position);mesh.geometry.computeBoundingSphere();
      const pixels=mesh.geometry.boundingSphere.radius*mesh.scale.x/range*innerHeight/(2*Math.tan(camera.fov*Math.PI/360));
      point.project(camera);if(Math.abs(point.x)<1&&Math.abs(point.y)<1&&Math.abs(point.z)<1&&pixels>=4)visible++;
    }
    return {live:f.effects.debris.activeCount,visibleAtLeast4px:visible};
  });
  await page.waitForTimeout(4220);
  if(mode==='cpu')writeFileSync(`${out}/${label}-impact.cpuprofile`,JSON.stringify((await cdp.send('Profiler.stop')).profile));
  if(mode==='trace'){
    const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');const {stream}=await done;let text='';
    for(;;){const c=await cdp.send('IO.read',{handle:stream,size:1<<22});text+=c.base64Encoded?Buffer.from(c.data,'base64').toString():c.data;if(c.eof)break;}
    await cdp.send('IO.close',{handle:stream});const events=JSON.parse(text).traceEvents;let pid;
    for(const e of events)for(const f of e.args?.data?.frames??[])if(f.url?.startsWith(base))pid=f.processId??e.pid;
    writeFileSync(`${out}/${label}-impact.trace.json.gz`,gzipSync(JSON.stringify({metadata:{pagePid:pid,pageUrl:base},traceEvents:events.filter(e=>e.pid===pid||e.ph==='M')})));
  }
  await cdp.detach();
  report.impact=await page.evaluate(()=>window.__wp1);
} finally {
  writeFileSync(`${out}/${label}-impact-profile.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await context.close();await browser.close();
}
