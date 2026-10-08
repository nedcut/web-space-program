// Windows Firefox staging comparison; run under /tmp/wsp-gpu.lock from WSL.
// node.exe wp1-firefox-staging.mjs <url> <tag> firefox <settingsJson> [seconds]
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync } from 'node:fs';
const [url,tag='wp1-firefox',,settingsJson='{}',secs='4']=process.argv.slice(2);
const profile=`C:/wsp-tools/ff-profile-${tag}`;
rmSync(profile,{recursive:true,force:true});mkdirSync(profile,{recursive:true});
const browser=await puppeteer.launch({browser:'firefox',headless:false,executablePath:'C:/Program Files/Mozilla Firefox/firefox.exe',userDataDir:profile,args:['--width=1600','--height=1000'],defaultViewport:null,extraPrefsFirefox:JSON.parse(process.env.FF_PREFS||'{}')});
const page=(await browser.pages())[0]??await browser.newPage();
page.on('pageerror',e=>console.log(`[pageerror] ${e.stack}`));
page.on('console',m=>{if(m.type()==='error')console.log(`[error] ${m.text()}`);});
await page.evaluateOnNewDocument(s=>{localStorage.setItem('wsp.help.seen.v1','1');localStorage.setItem('wsp.settings.v1',JSON.stringify({graphicsProfile:99,...JSON.parse(s)}));},settingsJson);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
  await page.goto(url,{waitUntil:'load',timeout:120000});
  for(let i=0;i<300&&!(await page.evaluate(()=>!!window.__flight&&!document.querySelector('.loading-screen')));i++)await sleep(500);
  await sleep(8000);
  await page.evaluate(()=>{window.__perf.reset();window.__perf.enabled=true;});
  console.log('staging',JSON.stringify(await page.evaluate(async()=>{const f=window.__flight;f.stage();await new Promise(r=>setTimeout(r,300));f.stage();await new Promise(r=>setTimeout(r,3000));return {dpr:devicePixelRatio,warmup:f.warmup,programs:f.pipeline.renderer.info.programs.length};})));
  await sleep(Number(secs)*1000);
  console.log(JSON.stringify(await page.evaluate(()=>({summary:window.__perf.summary(),dpr:devicePixelRatio,size:[innerWidth,innerHeight]}))));
  await page.screenshot({path:`C:/wsp-tools/shots/${tag}.png`});
} finally {await browser.close();}
