import { describe, it, expect } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { serializeWorld, deserializeWorld } from '../src/game/persistence';
import { PART_CATALOG } from '../src/data/parts';
import { LANDMARKS, landmarkPosition, nearbyLandmarks } from '../src/sim/terrain/landmarks';
import { latLonToUnit, createTerrain } from '../src/sim/terrain';
import { biomeAt } from '../src/sim/science/biomes';
import { add, sub, dot, scale, length } from '../src/util/vec3';
import { buildVessel, neutralInput, stepVessel } from '../src/sim/vessel';
import { flatEarthEnv, TEST_CATALOG, stackCraft, NOSE_UP } from '../src/sim/vessel/testing';
import { buildChunk } from '../src/render/planet/chunkBuilder';

const u = new Universe('standard');
describe('distinctive surfaces', () => {
  it('Titan sea physics and biome agree and the equator stays dry', () => {
    const terrain = u.terrain('titan'), body = u.body('titan');
    expect(terrain.liquid?.density).toBe(550);
    for (const [lat, lon] of [[76,40],[80,115],[69,-55]]) {
      const d=latLonToUnit(lat,lon);
      expect(terrain.heightAt(d.x,d.y,d.z)).toBeLessThan(terrain.liquid!.level);
      expect(biomeAt(body,terrain,d)).toBe('Hydrocarbon Seas');
      const rel=u.ephem.fromBodyFixed('titan',scale(d,body.radius),0);
      const pos=add(u.ephem.getBodyState('titan',0).position,rel);
      const g=u.createEnvironment(()=> 'titan').ground(pos,0)!;
      expect(g.isWater).toBe(true); expect(g.liquidDensity).toBe(550);
    }
    for(let lon=-180;lon<180;lon+=10) {
      const d=latLonToUnit(0,lon);
      expect(biomeAt(body,terrain,d)).not.toBe('Hydrocarbon Seas');
    }
  });
  it('liquid mesh vertices use the shared body-specific level', () => {
    const terrain = { heightAt:()=>-100, maxHeight:0, minHeight:-100, ocean:true, liquid:{level:-40,density:550,kind:'hydrocarbon' as const} };
    const c=buildChunk(terrain,{face:4,level:8,ix:128,iy:128,res:8,radius:200000,ocean:true});
    expect(c.ocean).toBeDefined();
    for(let i=0;i<81;i++) {
      const p=c.ocean!.positions;
      expect(Math.hypot(p[i*3]+c.center[0],p[i*3+1]+c.center[1],p[i*3+2]+c.center[2])).toBeCloseTo(199960,2);
      expect(c.ocean!.depth[i]).toBe(60);
    }
  });
  it('buoyant lander settles deeper in Titan liquid than Earth water at the predicted draft', () => {
    const heights:number[]=[];
    for(const density of [1000,550]) {
      const env=flatEarthEnv({surface:'water',g:1.35,rho0:0,p0:0});
      const ground=env.ground;
      env.ground=(p,t)=>({...ground(p,t)!,liquidDensity:density});
      const v=buildVessel(stackCraft(['ballast']),TEST_CATALOG,{orientation:NOSE_UP,position:{x:0,y:0,z:1}});
      for(let i=0;i<4000;i++) stepVessel(v,neutralInput(),env,i*0.02);
      const volume=Math.PI*0.25, size=2*Math.cbrt(3*volume/(4*Math.PI));
      expect(v.situation).toBe('splashed');
      expect(v.position.z).toBeCloseTo((0.5-v.mass/(density*volume))*size,2);
      heights.push(v.position.z);
    }
    expect(heights[1]).toBeLessThan(heights[0]);
  });
  it('a lander floats on the actual Sable Sea terrain at the expected methane draft', () => {
    const body=u.body('titan'), terrain=u.terrain('titan'), d=latLonToUnit(76,40);
    const n=u.ephem.fromBodyFixed('titan',d,0);
    const surface=add(u.ephem.getBodyState('titan',0).position,scale(n,body.radius+terrain.liquid!.level));
    const real=u.createEnvironment(()=> 'titan');
    // Freeze the reference frame to isolate draft from orbit/spin, retaining real terrain samples.
    const env=flatEarthEnv({surface:'water',rho0:0,p0:0});
    env.gravity=()=>scale(n,-body.surfaceGravity);
    env.ground=p=>{const g=real.ground(p,0)!;return {...g,surfaceVelocity:{x:0,y:0,z:0}};};
    const v=buildVessel(stackCraft(['ballast']),TEST_CATALOG,{position:add(surface,scale(n,1))});
    for(let i=0;i<4000;i++) stepVessel(v,neutralInput(),env,i*0.02);
    const volume=Math.PI*0.25,size=2*Math.cbrt(3*volume/(4*Math.PI));
    expect(v.situation).toBe('splashed');
    expect(dot(sub(v.position,surface),n)).toBeCloseTo((0.5-v.mass/(550*volume))*size,2);
  });
  it('landmark bases match collision height within a centimetre at every scale', () => {
    for(const preset of ['standard','challenging','real'] as const) {
      const universe=new Universe(preset);
      for(const l of LANDMARKS) {
        const body=universe.body(l.body),t=universe.terrain(l.body),d=latLonToUnit(l.lat,l.lon);
        const p=landmarkPosition(body,t,l);
        expect(Math.abs(length(p)-body.radius-t.heightAt(d.x,d.y,d.z))).toBeLessThan(0.01);
        expect(nearbyLandmarks(body,t,p,[])).toContain(l);
        expect(nearbyLandmarks(body,t,scale(d,length(p)+2001),[])).not.toContain(l);
      }
    }
  });
  it('discoveries emit once, award science once, and survive a real save/load', () => {
    const w=new World(u,TEST_CATALOG,0,'science'),l=LANDMARKS[0];
    const fixed=landmarkPosition(u.body(l.body),u.terrain(l.body),l);
    const state=buildVessel(stackCraft(['ballast']),TEST_CATALOG);
    state.position=add(u.ephem.getBodyState(l.body,0).position,u.ephem.fromBodyFixed(l.body,fixed,0));
    w.vessels.set(state.id,{state,body:l.body,mode:'physics'});
    const events:string[]=[]; w.onEvent=e=>events.push(e.type);
    w.discoverLandmarks(); w.discoverLandmarks();
    expect(w.discoveries).toEqual([l.id]); expect(w.progression.science).toBe(25);
    expect(events).toEqual(['anomalyDiscovered']);
    const restored=deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))),TEST_CATALOG,u);
    restored.discoverLandmarks(); expect(restored.progression.science).toBe(25); expect(restored.discoveries).toEqual([l.id]);
    const old=serializeWorld(new World(u,PART_CATALOG,0)); delete old.discoveries;
    expect(deserializeWorld(old,PART_CATALOG,u).discoveries).toEqual([]);
  });
  it('named feature samples remain deterministic and bounded', () => {
    for(const l of LANDMARKS) {
      const body=u.body(l.body),a=createTerrain(body),b=createTerrain(body),d=latLonToUnit(l.lat,l.lon);
      const h=a.heightAt(d.x,d.y,d.z); expect(h).toBe(b.heightAt(d.x,d.y,d.z));
      expect(h).toBeGreaterThanOrEqual(a.minHeight); expect(h).toBeLessThanOrEqual(a.maxHeight);
    }
  });
});
