import { buildFoundationOrbiter, buildOrbiter, buildSoundingRocket } from '../src/editor/stockCrafts';
import { PART_CATALOG } from '../src/data/parts';
import { launchCost, launchProblem, unlockTech } from '../src/data/technology';
import { newProgression, generateContracts, acceptContract, evaluateContracts } from '../src/sim/science/progression';
import { EXPERIMENTS, scienceValue, subjectKey } from '../src/sim/science/experiments';
import { BIOMES } from '../src/sim/science/biomes';
import type { ScienceContext } from '../src/sim/science/experiments';

export function standardCampaign() {
const p = newProgression(), runs = new Map<string, number>();
const missions: { name: string; craft: ReturnType<typeof buildOrbiter>; contexts: ScienceContext[]; research?: string[]; orbit?: boolean; moon?: boolean }[] = [
  { name: 'Pad survey / short hop', craft: buildSoundingRocket(), contexts: [{body:'earth',biome:'Launch Complex',situation:'landed'}], research:['discovery-0'] },
  { name: 'Low atmosphere / grassland hop', craft: buildSoundingRocket(), contexts: [{body:'earth',biome:'Grasslands',situation:'flyingLow'},{body:'earth',biome:'Grasslands',situation:'landed'}], research:['propulsion-0','energy-0'] },
  { name: 'High atmosphere / splashdown', craft: buildSoundingRocket(), contexts: [{body:'earth',biome:'Shores',situation:'flyingHigh'},{body:'earth',biome:'Shores',situation:'splashed'}] },
  { name: 'First orbit', craft: buildFoundationOrbiter(), contexts: [{body:'earth',biome:'Global',situation:'spaceLow'}], orbit:true, research:['propulsion-1','structures-0'] },
  { name: 'Orbital repeat / technique', craft: buildFoundationOrbiter(), contexts: [{body:'earth',biome:'Global',situation:'spaceLow'}], orbit:true },
  { name: 'Higher orbit survey', craft: buildOrbiter(), contexts: [{body:'earth',biome:'Global',situation:'spaceHigh'}], orbit:true },
  { name: 'New surface research', craft: buildSoundingRocket(), contexts: [{body:'earth',biome:'Mountains',situation:'landed'}], research:['structures-1','guidance-0'] },
  { name: 'Orbit practice', craft: buildOrbiter(), contexts: [], orbit:true },
  { name: 'New field site', craft: buildSoundingRocket(), contexts: [{body:'earth',biome:'Deserts',situation:'landed'}] },
  { name: 'Departure rehearsal', craft: buildOrbiter(), contexts: [], orbit:true },
  { name: 'Moon flyby', craft: buildOrbiter(), contexts: [{body:'moon',biome:'Global',situation:'spaceHigh'}], orbit:true, moon:true },
  { name: 'Lunar science follow-up', craft: buildOrbiter(), contexts: [{body:'moon',biome:'Global',situation:'spaceLow'}], orbit:true, moon:true },
];
const rows: (string|number)[][] = [];
for (const [index, mission] of missions.entries()) {
  // Request successive batches; decline unflown offers without collecting their advances.
  p.contracts = generateContracts(p.contractSeed, index, false, 1, {orbit:p.milestones.includes('first-orbit') && p.unlocked.includes('propulsion-0'), lunar:p.milestones.includes('first-moon-flyby'), landing:p.milestones.includes('first-moon-flyby') && p.unlocked.includes('structures-1')});
  for (const c of p.contracts) if ((c.kind === 'orbit' && mission.orbit && c.body === 'earth') || (c.kind === 'flyby' && mission.moon) || (c.kind === 'science' && mission.contexts.some(x=>x.body===c.body && x.biome===c.biome)) || (c.kind === 'return' && c.body === 'earth')) acceptContract(p,c.id,0);
  const instruments = ['sensor-thermal', ...(p.unlocked.includes('discovery-0') && mission.contexts.some(c => c.body === 'earth' && ['landed','splashed','flyingLow','flyingHigh'].includes(c.situation)) ? ['sensor-pressure'] : []), ...(p.unlocked.includes('discovery-0') && mission.contexts.some(c => c.situation === 'landed') ? ['sensor-seismic'] : [])];
  for (const [i, id] of instruments.entries()) mission.craft.parts.push({ uid: 1000+i, partId: id, parent: mission.craft.parts[0].uid, attachNode: 'srf', position: {x:0.7,y:i*0.2,z:0}, rotation: {x:0,y:0,z:0,w:1} });
  const problem = launchProblem(mission.craft,PART_CATALOG,'career',p); if(problem)throw Error(problem);
  p.funds -= launchCost(mission.craft,PART_CATALOG);
  let science = 0;
  for (const context of mission.contexts) {
    if (context.biome !== 'Global' && !BIOMES[context.body].includes(context.biome)) throw Error(`Invalid biome ${context.biome}`);
    const ids = ['temperature','crewReport', ...(p.unlocked.includes('discovery-0') ? ['pressure','seismic'] : []), ...(context.situation==='landed' ? ['surfaceSample'] : [])];
    for (const id of ids) {
      const e = EXPERIMENTS.find(e=>e.id===id)!;
      if (!e.situations.includes(context.situation) || (id==='pressure' && context.body==='moon')) continue;
      const key = subjectKey(e,context), count=runs.get(key)??0;
      science += scienceValue(e.base,context.body==='moon'?3:1,count); runs.set(key,count+1);
      evaluateContracts(p,{type:'science',body:context.body,biome:e.biomes.includes(context.situation)?context.biome:'Global',vesselId:'campaign'});
    }
  }
  if(mission.orbit){evaluateContracts(p,{type:'orbit',body:'earth',vesselId:'campaign'});if(!p.milestones.includes('first-orbit')){p.milestones.push('first-orbit');science+=20;p.funds+=15000;}}
  if(mission.moon){evaluateContracts(p,{type:'soi',body:'moon',vesselId:'campaign'});if(!p.milestones.includes('first-moon-flyby')){p.milestones.push('first-moon-flyby');science+=35;p.funds+=40000;}}
  evaluateContracts(p,{type:'landed',body:'earth',vesselId:'campaign'});evaluateContracts(p,{type:'recovered',body:'earth',visited:['earth'],vesselId:'campaign'});
  p.science += science;
  for(const id of mission.research??[]) if(!unlockTech(p,id))throw Error(`Unaffordable research ${id} after mission ${index+1}`);
  rows.push([index+1,mission.name,launchCost(mission.craft,PART_CATALOG),science.toFixed(1),p.science.toFixed(1),p.funds,(mission.research??[]).join(', ')||'—']);
}
return { rows, progression: p };
}
