/** Headless render CPU/structural benchmark; these are NOT measured GPU draw calls. */
import * as THREE from 'three';
import { performance } from 'node:perf_hooks';
import { STOCK_CRAFTS } from '../../src/editor/stockCrafts';
import { PART_CATALOG } from '../../src/data/parts';
import { buildVessel } from '../../src/sim/vessel';
import { VesselView } from '../../src/render/vessel/VesselView';
import { Universe } from '../../src/game/universe';
import { stateToElements, predictTrajectory } from '../../src/sim/orbit';
// Only MapView's canvas icons/HTML labels need a DOM; no WebGL is constructed.
const node = () => ({ style: {}, appendChild() {}, remove() {}, getContext: () => ({ beginPath(){}, arc(){}, stroke(){}, fill(){}, moveTo(){}, lineTo(){} }) });
const u = new Universe('standard');
for (const craft of [STOCK_CRAFTS[0], STOCK_CRAFTS[2]]) {
 const v=buildVessel(craft.build(), PART_CATALOG), view=new VesselView(v);
 view.update({x:0,y:0,z:0},0,0,.02);
 let meshes=0, triangles=0;
 view.root.traverseVisible(o=>{if(o instanceof THREE.Mesh) { meshes++; triangles+=(o.geometry.index?.count ?? o.geometry.getAttribute('position').count)/3 * (o instanceof THREE.InstancedMesh?o.count:1); }});
 let t=performance.now(); for(let i=0;i<10000;i++) view.update({x:0,y:0,z:0},i*.02,0,.02);
 console.log(JSON.stringify({name:`vessel/${craft.id}`, meshes,triangles,updateUs:(performance.now()-t)/10})); view.dispose();
}
Object.assign(globalThis,{document:{createElement:node},window:{devicePixelRatio:1}});
const {MapView}=await import(process.env.BENCH_BASELINE ? '../../src/render/map/MapView.baseline.ts' : '../../src/render/map/MapView.ts');
const map=new MapView(u.bodies,u.ephem,node() as unknown as HTMLElement);
const b=u.body('earth'), t=1e8, state={position:{x:b.radius+2e6,y:0,z:0},velocity:{x:0,y:Math.sqrt(b.gm/(b.radius+2e6)),z:0}};
const orbit=stateToElements(b.gm,'earth',state.position,state.velocity,t);
const patches=predictTrajectory({ephem:u.ephem,bodies:u.bodies,initialBody:'earth',state,t0:t,horizon:10000});
const focus=u.ephem.getBodyState('earth',t).position;
const update={t,focus,viewport:{width:1280,height:800},vessel:{position:focus,patches,nodes:[{id:'bench',time:t+100,prograde:10,normal:0,radial:0}]}};
map.update(update);
const original=new Set(map.scene.children.map(o=>o.uuid));
const samples=[];for(let r=0;r<9;r++){const start=performance.now();for(let i=0;i<500;i++)map.update(update);samples.push((performance.now()-start)*2);}
samples.sort((a,b)=>a-b);
console.log(JSON.stringify({name:'map/update',medianUs:samples[4],p95Us:samples[8],newObjectsInFinalFrame:map.scene.children.filter(o=>!original.has(o.uuid)).length}));
map.dispose();void orbit;
const { Quadtree, ChunkNode } = await import(process.env.BENCH_BASELINE ? '../../src/render/planet/quadtree.baseline.ts' : '../../src/render/planet/quadtree.ts');
const { TerrainWorkerPool } = await import('../../src/render/planet/workerPool');
const material=new THREE.MeshBasicMaterial();
const tree = new Quadtree({terrainKey:'bench',radius:6e5,minHeight:-100,maxHeight:100,res:24,maxLevel:8,ocean:false,pool:new TerrainWorkerPool(0),terrainMaterial:material,maxInFlight:0,buildBudgetMs:0,cacheSize:1000});
for(let i=0;i<512;i++){
 const n = new ChunkNode({face:0,level:5,ix:i%32,iy:Math.floor(i/32)},6e5);
 n.data={center:[6e5,i,0]} as typeof n.data;n.mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);tree.selected.push(n);
}
const q=new THREE.Quaternion(),m=new THREE.Matrix3();
const qt=[];for(let r=0;r<9;r++){const start=performance.now();for(let i=0;i<500;i++)tree.place(-6e5,0,0,q,m);qt.push((performance.now()-start)*2);}qt.sort((a,b)=>a-b);
console.log(JSON.stringify({name:'quadtree/place/512',medianUs:qt[4],p95Us:qt[8]}));
const moving=[];for(let r=0;r<9;r++){const start=performance.now();for(let i=0;i<500;i++)tree.place(-6e5+i*.1,0,0,q,m);moving.push((performance.now()-start)*2);}moving.sort((a,b)=>a-b);
console.log(JSON.stringify({name:'quadtree/place/512/moving',medianUs:moving[4],p95Us:moving[8]}));
