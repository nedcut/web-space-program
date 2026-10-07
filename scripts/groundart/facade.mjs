// Close view of original assembly-building cladding and roof details, plus shadows-off smoke check.
import { openPage } from './raw-cdp.mjs';
import { writeFileSync } from 'node:fs';
const page=await openPage();
try {
 await page.navigate('http://localhost:5334/?scene=spaceCenter&hubCam=-0.714,1191,150,700,60,-980');
 await page.until('!!window.__hub');
 await page.evaluate(()=>{document.querySelector('.hub-composition').style.visibility='hidden';});
 await new Promise(r=>setTimeout(r,6000));
 await page.send('Page.bringToFront');
 const {data}=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 writeFileSync('C:/wsp-tools/shots/groundart-after-facade.png',Buffer.from(data,'base64'));
 await page.evaluate(()=>{window.__hub.pipeline.renderer.shadowMap.enabled=false;});
 await new Promise(r=>setTimeout(r,1500));
 const result=await page.evaluate(()=>({shadows:window.__hub.pipeline.renderer.shadowMap.enabled,glError:window.__hub.pipeline.renderer.getContext().getError()}));
 if(result.shadows || result.glError || page.errors.length)throw new Error(JSON.stringify({result,errors:page.errors}));
 console.log(result);
} finally {await page.close();}
