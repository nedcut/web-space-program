// Hardware elapsed queries around the existing compositor passes; run with Windows Node.
// Usage: node passes.mjs <base-url> <label> (writes C:/wsp-tools/bench/<label>-passes.json).
import { openPage } from './raw-cdp.mjs';
import { writeFileSync } from 'node:fs';
const [base, label] = process.argv.slice(2);
const page = await openPage();
await page.navigate(base.replace(/\/$/, '')+'/?flight=stock-kestrel');
await page.until('!!window.__flight && !document.querySelector(".loading-screen")');
await new Promise(r=>setTimeout(r,12000));
const result = await page.evaluate(async () => {
 const p=window.__flight.pipeline,gl=p.renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 if(!ext) throw new Error('Hardware timer unavailable');
 const wholeMs=p.gpuMs;
 const originalTimer=p.gpuTimer;p.gpuTimer=null;
 const pending=[], samples={}, originals=[];
 let disjoint=false;
 const poll=()=>{
  if(gl.getParameter(ext.GPU_DISJOINT_EXT)) disjoint=true;
  for(let i=pending.length-1;i>=0;i--){const [query,name]=pending[i];if(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))continue;
   (samples[name]??=[]).push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(query);pending.splice(i,1);
  }
 };
 for(const [index,pass] of p.composer.passes.entries()){
  const render=pass.render;
  const name=pass===p.renderPass?'scene+shadows':pass===p.bloomPass?'bloom':pass===p.smaaPass?'SMAA':pass===p.photoEffects?'photo':`output-${index}`;
  originals.push([pass,render]);
  pass.render=function(...args){poll();const query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);const r=render.apply(this,args);gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push([query,name]);return r;};
 }
 await new Promise(r=>setTimeout(r,6000));
 for(const [pass,render] of originals)pass.render=render;
 await new Promise(r=>setTimeout(r,500));poll();p.gpuTimer=originalTimer;
 for(const [q]of pending)gl.deleteQuery(q);
 const summary={};
 for(const [name,values]of Object.entries(samples)){const s=values.slice(30).sort((a,b)=>a-b);summary[name]={n:s.length,medianMs:s[Math.floor(s.length/2)],p95Ms:s[Math.floor(s.length*.95)]};}
 return {gpu:p.gpuName,canvas:[p.renderer.domElement.width,p.renderer.domElement.height],wholeMs,disjoint,glError:gl.getError(),passes:summary,stats:p.stats};
});
writeFileSync(`C:/wsp-tools/bench/${label}-passes.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
await page.close();
