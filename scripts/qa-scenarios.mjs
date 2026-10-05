// Scenario browser QA. Run against this worktree's Vite server: node scripts/qa-scenarios.mjs
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = new URL('../docs/qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(90000);
const report = { checks: [], errors: [], warnings: [] };
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); if (m.type() === 'warning') report.warnings.push(m.text()); });
page.on('dialog', d => d.accept());
const save = () => writeFile(new URL('scenario-report.json', out), JSON.stringify(report, null, 2));
const check = async (name, fn) => { console.log('START',name); try { const detail = await fn(); report.checks.push({ name, status: 'pass', detail }); console.log('PASS', name, JSON.stringify(detail ?? '')); } catch (e) { await page.screenshot({path:new URL('failure-'+report.checks.length+'.png',out).pathname,timeout:10000}).catch(()=>{}); console.log('PAGE',await page.locator('body').innerText({timeout:10000}).catch(()=>'')); report.checks.push({ name, status: 'fail', error: e.message }); console.log('FAIL', name, e.message); } await save(); };
const shot = name => page.screenshot({ path: new URL(`${name}.png`, out).pathname, timeout: 90000 });
const scene = async (name, patch = {}) => page.evaluate(async ({name, patch}) => { const {game} = await window.__qaImport('/src/game/store.ts'); game.set({ scene: name, ...patch }); }, {name, patch});
const flightReady = async () => { await page.waitForFunction(() => window.__flight && document.querySelector('.hud-dock')); await page.locator('.loading-screen').waitFor({state:'hidden'}); };
try {
  await page.addInitScript(()=>{localStorage.setItem('wsp.settings.v1',JSON.stringify({quality:'low',shadows:false,bloom:false,clouds:false,scatter:false,renderScale:0.5,masterVolume:0,autoSaveInterval:0,reduceMotion:true}));localStorage.setItem('wsp.help.seen.v1','1');});
  await page.goto('http://localhost:5192/');
  await page.evaluate(()=>{window.__qaImport=async path=>import(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>new URL(n).pathname===path).at(-1)??path);});
  await check('Training 1: build, stage, launch; practice save isolation',async()=>{
    await page.getByRole('button',{name:'Training',exact:true}).click();
    const before=await page.evaluate(()=>localStorage.getItem('wsp.world.v1.autosave'));
    await page.getByRole('button',{name:/Building your first rocket/}).click();
    await page.waitForFunction(()=>window.__editor);
    const components=['pod-lantern-1','tank-1-short','eng-sirocco','chute-main'];
    for(let i=0;i<components.length;i++){
      await page.evaluate(async ({components,i})=>{
        const {CraftEditor}=await window.__qaImport('/src/editor/core/editor.ts');
        const {PART_CATALOG}=await window.__qaImport('/src/data/parts.ts');
        const editor=new CraftEditor(PART_CATALOG); const pod=editor.addRoot(components[0]);
        if(i>=1){const tank=editor.attachPart(components[1],pod.uid,'bottom','top');if(i>=2)editor.attachPart(components[2],tank.uid,'bottom','top');}
        if(i>=3)editor.attachPart(components[3],pod.uid,'top','bottom');
        const craft=editor.craft;for(const p of craft.parts){if(p.partId==='eng-sirocco')p.stage=1;if(p.partId==='chute-main')p.stage=0;}
        window.__editor.session.load(craft,false);
      },{components,i});
      console.log('Building component', i, await page.locator('.tutorial-panel').innerText());
      await page.getByRole('button',{name:'Next',exact:true}).click();
    }
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.getByRole('button',{name:/^Launch/}).click(); await flightReady();
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await expect(page.getByText(/Lesson complete/)).toBeVisible(); await shot('training-building');
    await page.getByRole('button',{name:'Lessons',exact:true}).click();
    expect(await page.evaluate(()=>localStorage.getItem('wsp.world.v1.autosave'))).toBe(before);
  });
  await check('Training 2: rebound throttle/stage/SAS after clicking Next',async()=>{
    await scene('training');
    await page.getByRole('button',{name:/First flight/}).click(); await flightReady();
    await page.evaluate(async()=>{const {getBindings,saveBindings}=await window.__qaImport('/src/input/bindings.ts');saveBindings({...getBindings(),throttleFull:['KeyP'],stage:['Space'],toggleSas:['KeyY']});});
    await expect(page.locator('.tutorial-panel p')).toContainText('press P');
    await page.keyboard.press('p'); await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.keyboard.press('Space'); await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.keyboard.press('y'); await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.evaluate(async()=>{
      const c=window.__flight;c.paused=true;const w=c.world,{neutralInput}=await window.__qaImport('/src/sim/vessel/index.ts');
      const altitude=()=>Math.hypot(...Object.values(w.relativeState(w.active).position))-w.universe.body(w.active.body).radius;
      for(let i=0;i<30000&&altitude()<10000&&!w.active.state.destroyed;i++)w.tick(0.02,neutralInput({throttle:1,sas:'stabilityAssist'}));
      if(altitude()<10000)throw new Error('Trainer failed to reach 10 km');
      c.input.state.throttle=0;
    });
    await page.getByRole('button',{name:'Next',exact:true}).click();
    const landing=await page.evaluate(async()=>{
      const w=window.__flight.world,{neutralInput}=await window.__qaImport('/src/sim/vessel/index.ts');let opened=false;
      while(w.active.state.nextStage>=0)w.tick(0.02,neutralInput({stage:true,sas:'stabilityAssist'}));
      for(let i=0;i<80000&&!w.active.state.destroyed&&w.active.state.situation==='flying';i++){
        w.tick(0.02,neutralInput({sas:'stabilityAssist'}));opened ||= w.active.state.parts.some(p=>p.chute?.phase==='semi'||p.chute?.phase==='full');
      }
      return{opened,situation:w.active.state.situation,destroyed:w.active.state.destroyed};
    });
    expect(landing.opened).toBe(true);expect(landing.destroyed).toBe(false);expect(landing.situation).not.toBe('flying');
    await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('button',{name:'Next',exact:true}).click();
    await expect(page.getByText(/Lesson complete/)).toBeVisible();await shot('training-first-flight');
    const result=await page.evaluate(()=>({sas:window.__flight.sasOn,mode:window.__flight.world.active.mode,throttle:window.__flight.input.state.throttle}));
    await page.getByRole('button',{name:'Lessons',exact:true}).click();
    await page.evaluate(async()=>{const {defaultBindings,saveBindings}=await window.__qaImport('/src/input/bindings.ts');saveBindings(defaultBindings());});
    return result;
  });
  await check('Lunar EVA: leave hatch, flag and board',async()=>{
    await scene('training');
    await page.getByRole('button',{name:/EVA.*Step outside/}).click(); await flightReady();
    const result=await page.evaluate(async()=>{
      const c=window.__flight;c.paused=true;
      const {neutralInput}=await window.__qaImport('/src/sim/vessel/index.ts');
      for(let i=0;i<50;i++)c.world.tick(0.02,neutralInput());
      const eva=c.world.goEva(); if(!eva)throw new Error('EVA failed');
      c.world.active.state.situation='landed'; c.world.plantFlag(); const flags=c.world.flags.length;
      const boarded=c.world.boardEva();return{flags,boarded};
    });expect(result.flags).toBe(1);expect(result.boarded).toBe(true);await shot('lunar-eva');
    await page.getByRole('button',{name:'Lessons',exact:true}).click();return result;
  });
  // Construct deterministic scenario snapshots using public World/scenario APIs, then render the actual flight scene.
  const launchScenario=async (id,setup)=>{
    await scene('menu');
    await page.evaluate(async({id,setup})=>{
      const {game,DEFAULT_START_UT}=await window.__qaImport('/src/game/store.ts');
      const {World}=await window.__qaImport('/src/game/world.ts'); const {Universe}=await window.__qaImport('/src/game/universe.ts');
      const {PART_CATALOG}=await window.__qaImport('/src/data/parts.ts'); const {STOCK_CRAFTS}=await window.__qaImport('/src/editor/stockCrafts.ts');
      const {serializeWorld}=await window.__qaImport('/src/game/persistence.ts');
      const scenarios=await window.__qaImport('/src/game/scenarios.ts'); const vec=await window.__qaImport('/src/util/vec3.ts');const quat=await window.__qaImport('/src/util/quat.ts');
      const world=new World(new Universe('standard'),PART_CATALOG,DEFAULT_START_UT);
      const craft=STOCK_CRAFTS.find(s=>s.id===`stock-${id}`).build(); const v=world.launch(craft);
      if(setup==='orbit')scenarios.placeInCircularOrbit(world,v,'earth',90000);
      if(setup==='dock'){scenarios.placeInCircularOrbit(world,v,'earth',90000);scenarios.spawnRendezvousTarget(world,craft,100);}
      if(setup==='moon')scenarios.placeOnSurface(world,v,'moon');
      if(setup==='rover'){
        const u=world.universe,t=world.ut,dir=vec.v3(1,0,0),rotation=u.ephem.bodyRotation('moon',t),up=quat.qRotate(rotation,dir),forward=quat.qRotate(rotation,vec.v3(0,1,0));
        const {quatFromBasis}=await window.__qaImport('/src/game/world.ts'); const right=vec.normalize(vec.cross(forward,up));
        const down=vec.v3(0,0,-1); const rel=vec.scale(up,u.body('moon').radius+u.terrain('moon').heightAt(1,0,0)+world.restOffset(v.state,down)+0.05),bs=u.ephem.getBodyState('moon',t);
        Object.assign(v,{body:'moon',mode:'physics',fixed:undefined});Object.assign(v.state,{position:vec.add(bs.position,rel),velocity:vec.add(bs.velocity,u.ephem.surfaceVelocity('moon',rel,t)),orientation:quatFromBasis(right,forward,up),situation:'landed'});
      }
      if(setup==='titan'){
        const u=world.universe,up=vec.normalize(vec.v3(0.7,0.2,0.68)),bs=u.ephem.getBodyState('titan',world.ut),rel=vec.scale(up,u.body('titan').radius+60000),position=vec.add(bs.position,rel),env=u.createEnvironment(()=>'titan');
        Object.assign(v,{body:'titan',mode:'physics',fixed:undefined});Object.assign(v.state,{position,velocity:vec.add(env.air(position,world.ut).windVelocity,vec.scale(up,-1200)),orientation:quat.qFromTo(vec.v3(0,1,0),up),situation:'flying'});
      }
      game.set({scene:'flight',craft,mode:'sandbox',trainingActive:false,multiplayer:null,launchPending:false,resumeWorld:serializeWorld(world)});
    },{id,setup});await flightReady();await page.evaluate(()=>window.__flight.paused=true);
  };
  await check('Docking scenario: capture and undock',async()=>{
    await launchScenario('tender','dock');
    const result=await page.evaluate(async()=>{
      const w=window.__flight.world,{freePorts,neutralInput}=await window.__qaImport('/src/sim/vessel/index.ts'),{add,sub}=await window.__qaImport('/src/util/vec3.ts');
      const a=w.active,b=[...w.vessels.values()].find(v=>v!==a),pa=freePorts(a.state)[0],pb=freePorts(b.state)[0];
      b.state.position=add(b.state.position,sub(pa.pos,pb.pos));b.state.velocity={...a.state.velocity};
      for(let i=0;i<20 && w.vessels.size>1;i++)w.tick(0.02,neutralInput());
      const merged=w.vessels.size===1;const undocked=w.undockActive();return{merged,undocked,vessels:w.vessels.size};
    });expect(result.merged).toBe(true);expect(result.undocked).toBeTruthy();await shot('docking');return result;
  });
  await check('Lunar rover: drive and brake',async()=>{
    await launchScenario('moonmoth','rover');
    const result=await page.evaluate(async()=>{const w=window.__flight.world,{neutralInput}=await window.__qaImport('/src/sim/vessel/index.ts'),{length}=await window.__qaImport('/src/util/vec3.ts');
      for(let i=0;i<300;i++)w.tick(0.02,neutralInput({wheelThrottle:0.8}));const speed=length(w.surfaceVelocity(w.active));
      for(let i=0;i<300;i++)w.tick(0.02,neutralInput({brakes:true}));return{speed,stopped:length(w.surfaceVelocity(w.active)),destroyed:w.active.state.destroyed};});
    expect(result.speed).toBeGreaterThan(0.5);expect(result.stopped).toBeLessThan(result.speed);expect(result.destroyed).toBe(false);await shot('moon-rover');return result;
  });
  await check('Lunar ISRU: drill deploys and produces feedstock',async()=>{
    await launchScenario('bedrock','moon');await page.getByRole('button',{name:'Resources',exact:true}).click();
    while(await page.getByRole('button',{name:'Deploy drill',exact:true}).count()) await page.getByRole('button',{name:'Deploy drill',exact:true}).first().click();
    const result=await page.evaluate(async()=>{const w=window.__flight.world,{neutralInput}=await window.__qaImport('/src/sim/vessel/index.ts'),{totalResource}=await window.__qaImport('/src/sim/vessel/resources.ts');
      const before=totalResource(w.active.state,'regolith');for(let i=0;i<500;i++)w.tick(0.02,neutralInput({gear:true}));
      return{before,after:totalResource(w.active.state,'regolith'),destroyed:w.active.state.destroyed,drill:w.active.state.parts.find(p=>p.drillDeployed)?.drillDeploy};});
    expect(result.after).toBeGreaterThan(result.before);expect(result.destroyed).toBe(false);await shot('moon-mining');return result;
  });
  await check('Titan atmospheric approach and safe chute landing',async()=>{
    await launchScenario('hazewalker','titan');await shot('titan-approach');
    const result=await page.evaluate(async()=>{const w=window.__flight.world,{neutralInput}=await window.__qaImport('/src/sim/vessel/index.ts'),{length}=await window.__qaImport('/src/util/vec3.ts');let armed=false,semi=false,full=false,steps=0;const v=w.active,count=v.state.parts.length;
      while(v.state.situation!=='landed'&&!v.state.destroyed&&steps++<16000){const alt=w.universe.surfaceInfo('titan',v.state.position,w.ut).heightAboveTerrain;const stage=!armed&&alt<12000&&v.state.telemetry.dynamicPressure<20000;if(stage)armed=true;w.tick(0.25,neutralInput({stage,gear:true,sas:'retrograde',sasReference:'surface'}));if(stage)w.tick(0.02,neutralInput({stage:true,gear:true,sas:'retrograde',sasReference:'surface'}));semi ||= v.state.parts.some(p=>p.chute?.phase==='semi');full ||= v.state.parts.some(p=>p.chute?.phase==='full');}
      return{steps,semi,full,situation:v.state.situation,speed:length(w.surfaceVelocity(v)),parts:v.state.parts.length,originalParts:count,destroyed:v.state.destroyed};});expect(result.situation).toBe('landed');expect(result.speed).toBeLessThan(5);expect(result.parts).toBe(result.originalParts);await shot('titan-landed');return result;
  });
  await check('Tracking Station comms overlay and Spacepedia navigation',async()=>{
    await page.evaluate(async()=>{const {game}=await window.__qaImport('/src/game/store.ts');game.set({resumeWorld:window.__flight.snapshot(),scene:'tracking',settings:{...game.get().settings,commsEnabled:true}});});
    await expect(page.getByRole('heading',{name:'Tracking Station'})).toBeVisible();
    await page.getByRole('checkbox',{name:/Signal links/}).uncheck();await page.getByRole('checkbox',{name:/Signal links/}).check();await shot('tracking-comms');
    await page.getByRole('button',{name:'Spacepedia',exact:true}).click();await expect(page.getByRole('heading',{name:'Spacepedia',exact:true})).toBeVisible();
    await shot('spacepedia');
  });
  await check('Console has no runtime or framebuffer errors',async()=>{expect(report.errors).toEqual([]);expect(report.warnings.filter(x=>/INVALID_FRAMEBUFFER|zero size/.test(x))).toEqual([]);});
}finally{await save();await browser.close();process.exitCode=report.checks.some(c=>c.status==='fail')||report.errors.length ? 1:0;}
