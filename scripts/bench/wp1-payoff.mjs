// Windows Chrome / real GPU payoff evidence. From WSL, hold /tmp/wsp-gpu.lock.
// node.exe wp1-payoff.mjs <base> <before|after> [C:/wsp-tools/shots/wp1]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const [base,label,out='C:/wsp-tools/shots/wp1'] = process.argv.slice(2);
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
const report={label,base,errors};
async function load(query='') {
  await page.goto(`${base}/?flight=stock-meridian${query}`);
  await page.waitForFunction(()=>window.__flight && !document.querySelector('.loading-screen'),null,{timeout:120000});
  await page.bringToFront(); await page.mouse.click(10,10); await page.waitForTimeout(3000);
  await page.evaluate(()=>{
    window.__wp1={lost:null,bar:null,tasks:[]};
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
async function beginVideo(name) {
  const folder=`${out}/${label}-${name}-frames`; mkdirSync(folder,{recursive:true});
  const cdp=await context.newCDPSession(page), frames=[];
  cdp.on('Page.screencastFrame',e=>{
    const n=frames.length; writeFileSync(`${folder}/${String(n).padStart(5,'0')}.jpg`,Buffer.from(e.data,'base64'));
    frames.push(e.metadata.timestamp); void cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId});
  });
  await page.evaluate(()=>{
    const audio=window.__flight.audio; audio?.resume();
    if(!audio?.context || !audio.master)return;
    const dest=audio.context.createMediaStreamDestination(); audio.master.connect(dest);
    const recorder=new MediaRecorder(dest.stream), chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data); recorder.start();
    window.__wp1Audio={recorder,chunks,dest,audio};
  });
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:75,maxWidth:1600,maxHeight:900,everyNthFrame:1});
  return async()=>{
    await cdp.send('Page.stopScreencast'); await cdp.detach();
    writeFileSync(`${folder}/timestamps.json`,JSON.stringify(frames));
    const audio=await page.evaluate(async()=>{
      const s=window.__wp1Audio; if(!s)return null;
      const done=new Promise(r=>s.recorder.onstop=r); s.recorder.stop(); await done;
      s.audio.master.disconnect(s.dest);
      const bytes=new Uint8Array(await new Blob(s.chunks).arrayBuffer());
      let binary=''; for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
      return btoa(binary);
    });
    if(audio)writeFileSync(`${out}/${label}-${name}-audio.webm`,Buffer.from(audio,'base64'));
    return frames.length;
  };
}
try {
  await load('&scenario=orbit');
  await page.evaluate(()=>{const f=window.__flight;f.input.state.throttle=0;f.stage();f.cam.distance=45;});
  await page.waitForTimeout(200);
  const profiler=await context.newCDPSession(page); await profiler.send('Profiler.enable'); await profiler.send('Profiler.start');
  report.profileStart=await page.evaluate(()=>performance.now());
  const stopStage=await beginVideo('staging');
  await page.evaluate(()=>{window.__wp1.tasks=[]; window.__flight.stage();});
  await page.waitForTimeout(120);
  await page.screenshot({path:`${out}/${label}-staging.png`});
  await page.waitForTimeout(3500);
  writeFileSync(`${out}/${label}-staging.cpuprofile`,JSON.stringify((await profiler.send('Profiler.stop')).profile));await profiler.detach();
  report.staging={frames:await stopStage(),...await page.evaluate(()=>({tasks:window.__wp1.tasks,programs:window.__flight.pipeline.renderer.info.programs.length}))};
  await load();
  await prepareCrash();
  await page.waitForTimeout(500);
  await page.screenshot({path:`${out}/${label}-crash-before-impact.png`});
  const stopCrash=await beginVideo('crash');
  await page.evaluate(()=>{window.__wp1.tasks=[];window.__flight.paused=false;});
  await page.waitForTimeout(280);
  await page.screenshot({path:`${out}/${label}-crash.png`});
  report.crashPeak=await page.evaluate(()=>({debris:window.__flight.effects.debris?.activeCount,programs:window.__flight.pipeline.renderer.info.programs.length,active:!!window.__flight.world.active}));
  await page.waitForTimeout(4100);
  await page.screenshot({path:`${out}/${label}-flight-ended.png`});
  report.crash={frames:await stopCrash(),...await page.evaluate(()=>({...window.__wp1,barDelay:window.__wp1.bar-window.__wp1.lost,paused:window.__flight.paused,warp:window.__flight.world.warp,active:!!window.__flight.world.active}))};
  if(label==='after') {
    await load('&scenario=orbit');
    await page.evaluate(()=>{window.__flight.stage();}); await page.waitForTimeout(400);
    await page.evaluate(()=>{window.__wp1.tasks=[];window.__flight.stage();}); await page.waitForTimeout(1500);
    report.eventTiming={staging:await page.evaluate(()=>window.__wp1.tasks)};
    await load(); await prepareCrash(); await page.waitForTimeout(200);
    await page.evaluate(()=>{window.__wp1.tasks=[];window.__flight.paused=false;});await page.waitForTimeout(4500);
    report.eventTiming.crash=await page.evaluate(()=>window.__wp1.tasks);
    await load();
    await page.evaluate(()=>{const f=window.__flight;f.paused=false;f.input.state.throttle=1;f.sasOn=true;f.sas='stabilityAssist';f.stage();});
    await page.evaluate(()=>{window.__flight.world.warp={mode:'physics',index:2}; window.__flight.cam.distance=3500;});
    try { await page.waitForFunction(()=>{const w=window.__flight.world,v=w.active;return !!v && w.universe.surfaceInfo(v.body,v.state.position,w.ut).heightAboveTerrain>=10000;},null,{timeout:120000}); }
    catch(e) { console.log('SMOKE STATE',await page.evaluate(()=>({paused:window.__flight.paused,active:window.__flight.world.active?.state,warp:window.__flight.world.warp,throttle:window.__flight.input.state.throttle,errors:document.body.innerText})));throw e; }
    await page.evaluate(()=>{
      const f=window.__flight,w=f.world,v=w.active.state, V=f.cam.camera.position.constructor;
      f.paused=true; f.updateCamera=()=>{};
      const up=new V().copy(v.position).sub(w.universe.ephem.getBodyState(w.active.body,w.ut).position).normalize();
      const side=new V(0,0,1).cross(up).normalize();
      f.cam.camera.position.copy(side).multiplyScalar(15000).addScaledVector(up,500);
      f.cam.camera.up.copy(up); f.cam.camera.lookAt(up.clone().multiplyScalar(-5000));f.cam.camera.updateMatrixWorld();
    });
    await page.waitForTimeout(1200); await page.screenshot({path:`${out}/after-smoke-10km.png`});
    report.smoke=await page.evaluate(()=>{const f=window.__flight,w=f.world,v=w.active;return {altitude:w.universe.surfaceInfo(v.body,v.state.position,w.ut).heightAboveTerrain,visible:f.effects.pool.object.visible};});
    report.audioRms=await page.evaluate(async()=>{
      const AudioClass=window.__flight.audio.constructor, game=window.__game, settings=game.get().settings;
      const real=window.AudioContext, rms=[];
      game.set({settings:{...settings,masterVolume:1,sfxVolume:1,musicVolume:0}});
      try {
        for(const thrust of [9000,3300000]) {
          const offline=new OfflineAudioContext(2,48000*2,48000);
          const proxy=new Proxy(offline,{get(target,key){
            if(key==='state')return 'running';
            if(['resume','suspend','close'].includes(key))return ()=>Promise.resolve();
            const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
          }});
          window.AudioContext=function(){return proxy;};
          const audio=new AudioClass();audio.resume();audio.setMusic('off');
          audio.update({vesselId:'rms',engines:[{type:'kerolox',count:1,size:Math.sqrt(thrust/200000),thrustFraction:thrust/3300000}],ambientPressure:101325,airspeed:0,mach:0,dynamicPressure:0,rcsActive:0,reentryHeat:0,inMapView:false,timeWarp:1,cameraDistance:15});
          const buffer=await offline.startRendering();let sum=0,n=0;
          for(const x of buffer.getChannelData(0).subarray(24000)){sum+=x*x;n++;}
          rms.push(Math.sqrt(sum/n));audio.dispose();
        }
      } finally {window.AudioContext=real;game.set({settings});}
      return {small:rms[0],booster:rms[1],ratio:rms[0]/rms[1]};
    });
    assert.ok(report.audioRms.booster>0 && report.audioRms.ratio<=.35,'9 kN / 3.3 MN engine RMS');
    await page.goto(`${base}/?mission=suicide-burn`);
    await page.waitForFunction(()=>window.__flight && !document.querySelector('.loading-screen'),null,{timeout:120000});
    await page.evaluate(()=>{window.__flight.startAssist('land');});
    await page.waitForFunction(()=>!!document.querySelector('.scenario-debrief'),null,{timeout:120000});
    await page.screenshot({path:`${out}/after-suicide-burn-result.png`});
    report.landing=await page.evaluate(()=>{
      const card=document.querySelector('.scenario-debrief').getBoundingClientRect(), f=window.__flight, v=f.world.active?.state;
      if(!v)return {card:{left:card.left,right:card.right},active:false};
      const V=f.cam.camera.position.constructor;
      const q=new f.cam.camera.quaternion.constructor(v.orientation.x,v.orientation.y,v.orientation.z,v.orientation.w);
      let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      for(const part of v.parts){
        const shape=part.def.shape, radius=shape.kind==='box'?Math.hypot(shape.size.x,shape.size.y,shape.size.z)/2:Math.hypot(Math.max(shape.radiusTop,shape.radiusBottom),shape.height/2);
        const center=new V(part.position.x-v.com.x,part.position.y-v.com.y,part.position.z-v.com.z).applyQuaternion(q);
        for(const x of [-radius,radius])for(const y of [-radius,radius])for(const z of [-radius,radius]){
          const point=new V(center.x+x,center.y+y,center.z+z).project(f.cam.camera);
          const px=(point.x+1)*innerWidth/2,py=(1-point.y)*innerHeight/2;
          left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);
        }
      }
      return {card:{left:card.left,right:card.right,top:card.top,bottom:card.bottom},vessel:{left,right,top,bottom},overlap:card.left<right&&card.right>left&&card.top<bottom&&card.bottom>top, text:document.querySelector('.scenario-debrief').textContent};
    });
    assert.equal(report.landing.overlap,false,'Suicide Burn card must clear the vessel');
  }
} finally {
  writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
  await context.close(); await browser.close();
}
