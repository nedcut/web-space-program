// Interleaved cold/warm flight loads without waiting for a 60-fps window.
import { openPage } from './raw-cdp.mjs';
import { writeFileSync } from 'node:fs';
const [baseA,baseB] = process.argv.slice(2);
const results=[];
for(let round=0;round<2;round++) for(const [side,base] of [['before',baseA],['after',baseB]]){
 const page=await openPage();
 try {
 for(const visit of ['cold','warm']){
  await page.navigate(base.replace(/\/$/,'')+'/?flight=stock-kestrel');
  await page.until('!!window.__flight && !document.querySelector(".loading-screen")');
  const data=await page.evaluate(()=>({readyMs:performance.getEntriesByName('wsp:flight:ready')[0]?.startTime,
   constructorMs:performance.getEntriesByName('wsp:flight:construct')[0]?.duration,
   maxTaskMs:Math.max(0,...window.__groundLoad.map(e=>e.ms)),longTasks:window.__groundLoad,
   gpu:window.__flight.pipeline.gpuName,glError:window.__flight.pipeline.renderer.getContext().getError()}));
  results.push({round,side,visit,...data});console.log(JSON.stringify(results.at(-1)));
  await new Promise(r=>setTimeout(r,1000));
 }
 } finally { await page.close(); }
}
writeFileSync('C:/wsp-tools/bench/groundart-load.json',JSON.stringify(results,null,2));
