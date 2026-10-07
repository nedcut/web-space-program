// Repeat interleaved pad GPU samples using the same timer as F8; page-scoped transport.
import { openPage } from './raw-cdp.mjs';
import { writeFileSync } from 'node:fs';
const [baseA,baseB] = process.argv.slice(2), results=[];
for(let round=0;round<2;round++) for(const [side,base] of [['before',baseA],['after',baseB]]) {
 const page=await openPage();
 try {
  await page.navigate(base.replace(/\/$/,'')+'/?flight=stock-kestrel');
  await page.until('!!window.__flight && !document.querySelector(".loading-screen")');
  const result=await page.evaluate(async()=>{
   const samples=[],intervals=[];let last=performance.now();
   for(let i=0;i<420;i++){await new Promise(requestAnimationFrame);const now=performance.now();if(i>=120){samples.push(window.__flight.pipeline.gpuMs);intervals.push(now-last);}last=now;}
   samples.sort((a,b)=>a-b);intervals.sort((a,b)=>a-b);
   const p=window.__flight.pipeline;
   return {gpu:p.gpuName,canvas:[p.renderer.domElement.width,p.renderer.domElement.height],gpuMedianMs:samples[150],gpuP95Ms:samples[285],frameP95Ms:intervals[285],stats:p.stats,glError:p.renderer.getContext().getError()};
  });
  results.push({round,side,...result});console.log(JSON.stringify(results.at(-1)));
  writeFileSync('C:/wsp-tools/bench/groundart-timing.json',JSON.stringify(results,null,2));
 } finally {await page.close();}
}
writeFileSync('C:/wsp-tools/bench/groundart-timing.json',JSON.stringify(results,null,2));
