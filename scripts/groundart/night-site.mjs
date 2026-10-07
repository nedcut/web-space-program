// Additional night pad inspection in the development Space Center scene.
import { openPage } from './raw-cdp.mjs';
import { writeFileSync } from 'node:fs';
const page=await openPage();
try {
 await page.navigate('http://localhost:5334/?scene=spaceCenter&hubCam=2.4,170,70,0,10,0');
 await page.until('!!window.__hub');
 await page.evaluate(async()=>{
  const {findGoldenHour}=await import('/src/ui/hub/HubScene.ts');
  const h=window.__hub;h.t=findGoldenHour(h.universe,h.site,h.t,-16,false);
  document.querySelector('.hub-composition').style.visibility='hidden';
 });
 await new Promise(r=>setTimeout(r,6000));
 const details=await page.evaluate(()=>({night:window.__hub.site.night.value,windows:window.__hub.site.windowMat.emissiveIntensity,glError:window.__hub.pipeline.renderer.getContext().getError()}));
 if(details.night<.9 || details.windows<=0 || details.glError)throw new Error(JSON.stringify(details));
 await page.send('Page.bringToFront');
 const {data}=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 writeFileSync('C:/wsp-tools/shots/groundart-after-night-site.png',Buffer.from(data,'base64'));
 console.log(details);
} finally {await page.close();}
