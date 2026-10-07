// Windows Node + session-scoped CDP; real RTX GPU, own context, deterministic DPR-2 views.
import { openPage } from './raw-cdp.mjs';
import { writeFileSync } from 'node:fs';
const [side = 'before', base = 'http://localhost:5334'] = process.argv.slice(2);
const cases = [
 ['pad','/?flight=stock-meridian'],
 ['center','/?scene=spaceCenter&hubCam=2.4,2200,750,300,0,-450'],
 ['land','/planet-preview.html?body=earth&alt=2000&lat=28.5&lon=-80.6&head=280&pitch=-20&hour=10&ui=0'],
 ['sunset','/planet-preview.html?body=earth&alt=120&lat=28.5&lon=-80.6&head=270&pitch=-3&hour=18&ui=0'],
 ['night','/planet-preview.html?body=earth&alt=900000&lat=28&lon=-80&pitch=-90&hour=0&ui=0'],
 ['moon','/planet-preview.html?body=moon&alt=8&lat=15&lon=25&head=130&pitch=-18&hour=9&ui=0'],
];
for (const [name,path] of cases.filter(([n]) => !process.argv[4] || process.argv[4].split(',').includes(n))) {
 console.log(side,name,'loading');
 const page = await openPage();
 try {
 await page.navigate(base+path);
 if(name==='center') await page.until("document.querySelectorAll('canvas').length > 0");
 if (name === 'pad') await page.until("window.__flight && !document.querySelector('.loading-screen')");
 if (!['pad','center'].includes(name)) await page.until('window.__preview?.ready');
 console.log(side,name,'ready');
 if (name === 'pad') await page.evaluate(() => { window.__flight.cam.mode = 'chase'; });
 await new Promise(r=>setTimeout(r,5000));
 if (name === 'pad') {
  await page.evaluate(() => { const c=window.__flight.cam; c.yaw=1.2; c.pitch=1.2; c.distance=110; });
  await new Promise(r=>setTimeout(r,3000));
 }
 if(await page.evaluate(() => !!document.querySelector('vite-error-overlay'))) throw new Error('Vite error overlay');
 if(name==='center') await page.evaluate(()=>{if(window.__hub) window.__hub.elapsed=0;});
 await page.send('Page.bringToFront');
 console.log(side,name,'capturing');
 const {data} = await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 writeFileSync(`C:/wsp-tools/shots/groundart-${side}-${name}.png`, Buffer.from(data,'base64'));
 if(page.errors.length) throw new Error(JSON.stringify(page.errors));
 console.log(side,name,await page.evaluate(()=>({size:[innerWidth,innerHeight,devicePixelRatio],renderer:(window.__flight?.pipeline ?? window.__hub?.pipeline ?? window.__preview?.pipeline)?.gpuName, glError:(window.__flight?.pipeline ?? window.__hub?.pipeline ?? window.__preview?.pipeline)?.renderer.getContext().getError()})));
 } finally { await page.close(); }
}

