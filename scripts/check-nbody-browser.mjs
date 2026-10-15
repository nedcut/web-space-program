import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto('http://localhost:5211/');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Gameplay',exact:true}).click();
  const precise=page.getByRole('checkbox',{name:'Precise gravity (n-body) · this save'});
  assert.equal(await precise.isChecked(),false);
  await precise.check();
  await page.getByRole('checkbox',{name:'Show Lagrange points in map'}).check();
  assert.equal(await page.evaluate(async()=> (await import('/src/game/store.ts')).game.get().resumeWorld.preciseGravity),true);
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.evaluate(async()=>{
    const [{World},{Universe},{PART_CATALOG},{buildOrbiter},{serializeWorld},{game},{add,v3}]=await Promise.all([
      import('/src/game/world.ts'),import('/src/game/universe.ts'),import('/src/data/parts.ts'),import('/src/editor/stockCrafts.ts'),import('/src/game/persistence.ts'),import('/src/game/store.ts'),import('/src/util/vec3.ts')]);
    const u=new Universe('standard'),w=new World(u,PART_CATALOG,0),v=w.launch(buildOrbiter()),b=u.ephem.getBodyState('earth',0),r=4e6;
    v.mode='physics';v.fixed=undefined;v.state.situation='flying';v.state.position=add(b.position,v3(r,0,0));v.state.velocity=add(b.velocity,v3(0,Math.sqrt(u.body('earth').gm/r),0));
    w.setPreciseGravity(true);w.showLagrangePoints=true;w.addNode(1000).prograde=20;
    game.set({resumeWorld:serializeWorld(w),scene:'flight',launchPending:false});
  });
  await page.waitForFunction(()=>window.__flight?.world?.active);
  await page.evaluate(()=>{window.__flight.toggleMap();window.__flight.map.distance=9e7;});
  await page.waitForFunction(()=>{
    const p=window.__flight.world.numericalPrediction;
    if (!p?.complete) return false;
    window.__nbodySamples=p.patches.reduce((n,p)=>n+p.samples.length,0);
    return true;
  },{},{timeout:60000});
  const result=await page.evaluate(()=>{
    const c=window.__flight,p=c.world.numericalPrediction;
    return {precise:c.world.preciseGravity,patches:p.patches.length,samples:window.__nbodySamples,
      markers:c.world.mapGravityMarkers().filter(m=>/ L[1-5]$/.test(m.label)).length,
      webgl:c.pipeline.renderer.getContext().getError(),lines:c.map.lines.vesselLines.length};
  });
  assert.equal(result.precise,true);assert.equal(result.markers,20);assert.ok(result.samples>10);assert.ok(result.lines>0);assert.equal(result.webgl,0);
  const help=page.getByRole('button',{name:'Got it',exact:true});
  if (await help.isVisible()) await help.click();
  await page.screenshot({path:'docs/screenshots/nbody-map.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result,errors}));
} catch(error) { console.log(JSON.stringify({errors, state:await page.evaluate(()=>({text:document.body.innerText.slice(-1600),map:window.__flight?.mapMode,ready:window.__flight?.sceneReady,ut:window.__flight?.world.ut,prediction:window.__flight?.world.numericalPrediction && {time:window.__flight.world.numericalPrediction.time,attempts:window.__flight.world.numericalPrediction.attempts,complete:window.__flight.world.numericalPrediction.complete}}))})); throw error; } finally {await browser.close();}
