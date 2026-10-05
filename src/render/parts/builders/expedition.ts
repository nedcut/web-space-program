import * as THREE from 'three';
import type { PartDef } from '../../../sim/vessel/types';
import { M } from '../materials';
import { box, cyl, grp, lathe, mk, rod, setDeployData, torus } from '../geom';
import { boxDims, cylDims, num, str } from './common';
import { buildEngine } from './engines';

/** Open frameworks have real beams, braces and mounting faces, rather than solid proxy boxes. */
export function buildFramework(def: PartDef): THREE.Object3D {
  const { w, h, d } = boxDims(def);
  const style = str(def, 'style', 'truss');
  const root = grp('framework');
  const metal: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const t = Math.min(w, d, h) * 0.09;
  if (style === 'beam') {
    metal.push(box(w, t, d).translate(0, (h-t)/2, 0), box(w,t,d).translate(0,-(h-t)/2,0));
    metal.push(box(w*0.16,h,d));
    for (const z of [-d*0.44,d*0.44]) metal.push(box(w,h,d*0.12).translate(0,0,z));
  } else if (style === 'truss') {
    const n = num(def, 'sides', 4);
    const radius = def.shape.kind === 'cylinder' ? def.shape.radiusTop - t : Math.min(w,d)/Math.SQRT2-t;
    for (let i=0;i<n;i++) {
      const a=i*2*Math.PI/n + (n===4 ? Math.PI/4 : 0), b=(i+1)*2*Math.PI/n + (n===4 ? Math.PI/4 : 0);
      const x=Math.sin(a)*radius,z=Math.cos(a)*radius,nx=Math.sin(b)*radius,nz=Math.cos(b)*radius;
      metal.push(rod([x,-h/2+t,z],[x,h/2-t,z],t/2,6));
      for (const y of [-h/2+t/2,h/2-t/2]) metal.push(rod([x,y,z],[nx,y,nz],t/2,6));
      for(let j=0;j<2;j++) dark.push(rod([x,-h/2+t+j*(h-2*t)/2,z],[nx,-h/2+t+(j+1)*(h-2*t)/2,nz],t*0.3,6));
    }

  } else if (style === 'ladder') {
    for (const x of [-w*0.4,w*0.4]) metal.push(box(w*0.08,h,d*0.3).translate(x,0,d*0.2));
    for(let y=-h/2+0.08;y<h/2;y+=0.24) dark.push(rod([-w*0.4,y,d*0.2],[w*0.4,y,d*0.2],0.018,8));
    for(const y of [-h*0.4,h*0.4]) metal.push(box(w,0.04,d*0.4).translate(0,y,-d*0.3));
  } else {
    metal.push(box(w,h,d*0.35).translate(0,0,-d*0.325));
    const ribs = style === 'radiator' ? 12 : 4;
    for(let i=0;i<ribs;i++) dark.push(box(w*0.94, h/(ribs*2),d*0.5).translate(0,-h*0.4+i*h*0.8/(ribs-1),d*0.05));
    for (const x of [-w/2+t/2,w/2-t/2]) metal.push(box(t,h,d).translate(x,0,0));
    for (const y of [-h/2+t/2,h/2-t/2]) metal.push(box(w,t,d).translate(0,y,0));
    if (style === 'chassis') {
      metal.push(box(w*0.75,h*0.75,d*0.25).translate(0,0,d*0.375));
      root.add(mk(box(w*0.5,h*0.5,0.015).translate(0,0,d/2),M.goldFoil(),'electronicsCover'));
    }
  }
  root.add(mk(metal,style==='radiator'?M.satinWhite():M.aluminium(),'frame'));
  if(dark.length) root.add(mk(dark,style==='radiator'?M.charcoalPanel():M.gunmetal(),'braces'));
  return root;
}

/** Two longitudinal hinged shells, end rings and interior equipment rails. */
export function buildBay(def: PartDef): THREE.Object3D {
  const { rTop:r,h } = cylDims(def);
  const root=grp('bay');
  const thick=Math.min(0.08,h*0.12);
  for(const y of [-h/2,h/2-thick]) root.add(mk(lathe([[r*0.88,y],[r,y],[r,y+thick],[r*0.88,y+thick],[r*0.88,y]],{segments:48}),M.gunmetal(),'endRing'));
  for(const x of [-r*0.65,r*0.65]) root.add(mk(box(r*0.06,h-2*thick,r*0.06).translate(x,0,-r*0.65),M.aluminium(),'equipmentRail'));
  for(const side of [-1,1]) {
    const hinge=grp(side<0?'bayDoorA':'bayDoorB');
    hinge.position.set(0,0,-r);
    setDeployData(hinge,{rot0:[0,0,0],rot1:[0,side*Math.PI*0.68,0]});
    const profile: [number,number][]=[[r*0.97,-h/2+thick],[r,-h/2+thick],[r,h/2-thick],[r*0.97,h/2-thick],[r*0.97,-h/2+thick]];
    const shell=lathe(profile,{segments:28,phiStart:side<0?Math.PI:0,phiLength:Math.PI});
    shell.translate(0,0,r);
    hinge.add(mk(shell,M.satinWhite(),'bayShell'));
    const seam=box(0.035,h-2*thick,0.025).translate(0,0,r*1.99);
    hinge.add(mk(seam,M.accent(str(def,'style','cargo')==='cargo'?'orange':'teal'),'doorSeam'));
    root.add(hinge);
  }
  return root;
}

export function buildHabitat(def: PartDef): THREE.Object3D {
  const {rTop:r,h}=cylDims(def),root=grp('habitat');
  root.add(mk(cyl(r*0.97,r*0.97,h-0.12,48),M.satinWhite(),'pressureHull'));
  for(const y of [-h/2+0.03,h/2-0.03]) root.add(mk(cyl(r,r,0.06,48,y),M.gunmetal(),'endcap'));
  for(const y of [-h*0.35,h*0.35]) root.add(mk(torus(r*0.97,0.025,6,48).translate(0,y,0),M.aluminium(),'reinforcement'));
  const n=num(def,'windows',8);
  for(let i=0;i<n;i++) {
    const a=i*2*Math.PI/n;
    const window=grp('window'); window.rotation.y=a; window.position.set(Math.sin(a)*r*0.975,h*0.13,Math.cos(a)*r*0.975);
    window.add(mk(box(r*0.28,h*0.16,0.035),M.gunmetal(),'windowFrame'));
    window.add(mk(box(r*0.23,h*0.12,0.012).translate(0,0,0.022),M.glass(),'windowGlass'));
    root.add(window);
  }
  root.add(mk(box(r*0.35,h*0.4,0.025).translate(0,-h*0.15,r*0.98),M.aluminium(),'crewHatch'));
  root.add(mk(box(r*0.22,0.045,0.035).translate(0,-h*0.13,r*1.005),M.accent('orange'),'hatchHandle'));
  if(def.meshParams?.lab) for(const x of [-r*0.45,r*0.45]) root.add(mk(box(0.2,h*0.35,0.15).translate(x,-h*0.1,-r*0.92),M.goldFoil(),'instrumentRack'));
  return root;
}

export function buildPowerUnit(def: PartDef): THREE.Object3D {
  const {w,h,d}=boxDims(def),root=grp('powerUnit');
  root.add(mk(box(w,h,0.025).translate(0,0,-d/2+0.0125),M.gunmetal(),'mount'));
  root.add(mk(box(w*0.62,h*0.85,d*0.75).translate(0,0,d*0.04),M.darkMetal(),'core'));
  const fins: THREE.BufferGeometry[]=[];
  for(let i=0;i<9;i++) fins.push(box(w*0.94,0.018,d*0.9).translate(0,-h*0.4+i*h*0.1,d*0.05));
  root.add(mk(fins,M.aluminium(),'coolingFins'));
  for(const x of [-w*0.25,w*0.25]) root.add(mk(rod([x,-h*0.45,d*0.35],[x,h*0.45,d*0.35],0.012,8),M.copperTubes(),'feedlines'));
  root.add(mk(box(w*0.2,0.025,0.015).translate(0,h*0.2,d*0.47),M.statusLed('green'),'powerIndicator'));
  return root;
}

export function buildRcsPorts(def: PartDef): THREE.Object3D {
  const {w,h,d}=boxDims(def),root=grp('rcsPorts');
  root.add(mk(box(w,h,0.025).translate(0,0,-d/2+0.0125),M.gunmetal(),'mount'));
  root.add(mk(box(w*0.5,h*0.5,d*0.55).translate(0,0,-d*0.06),M.satinWhite(),'valveBlock'));
  const m=def.modules.find(m=>m.type==='rcs');
  if(m?.type==='rcs') for(const nozzle of m.nozzles) {
    const dir=new THREE.Vector3(nozzle.direction.x,nozzle.direction.y,nozzle.direction.z);
    const mesh=mk(lathe([[0.025,0],[0.055,0.065],[0.045,0.065],[0.018,0]],{segments:16}),M.gunmetal(),'rcsNozzle');
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir);
    mesh.position.set(0,0,0.02).addScaledVector(dir,0.075);root.add(mesh);
  }
  return root;
}

export function buildNuclearEngine(def: PartDef): THREE.Object3D {
  const root=buildEngine(def),{rTop:r,h}=cylDims(def);
  const glow=M.thermalGlow();
  root.add(mk(cyl(r*0.65,r*0.65,h*0.26,32,h*0.16),M.gunmetal(),'reactorShield'));
  root.add(mk(torus(r*0.55,0.035,6,32).translate(0,-h*0.07,0),glow,'reactorGlow'));
  return root;
}

export function buildRadialEngine(def: PartDef): THREE.Object3D {
  const root=buildEngine(def),{h,rTop:r}=cylDims(def);
  root.add(mk(box(r*0.8,h*0.6,0.035).translate(0,h*0.1,-r+0.0175),M.gunmetal(),'radialBracket'));
  return root;
}

export function buildAerospike(def: PartDef): THREE.Object3D {
  const {rTop:r,h}=cylDims(def),root=grp('aerospike');
  root.add(mk(cyl(r,r,h*0.22,48,h*0.39),M.gunmetal(),'mount'));
  root.add(mk(cyl(r*0.8,r*0.8,h*0.4,40,h*0.08),M.copperTubes(),'annularChamber'));
  const gimbal=grp('gimbal'); root.add(gimbal);
  gimbal.add(mk(lathe([[r*0.1,-h/2],[r*0.28,-h*0.35],[r*0.54,-h*0.03]],{segments:48}),M.nozzleExt(),'expansionPlug'));
  gimbal.add(mk(torus(r*0.7,0.055,8,40).translate(0,-h*0.1,0),M.gunmetal(),'injectorRing'));
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6,x=Math.sin(a)*r*0.7,z=Math.cos(a)*r*0.7;
    gimbal.add(mk(cyl(0.035,0.055,h*0.13,12,-h*0.17).translate(x,0,z),M.darkMetal(),'chamberExit'));
    const anchor=grp('exhaustAnchor');anchor.position.set(x,-h/2,z);anchor.userData.exitRadius=0.045;gimbal.add(anchor);
  }
  return root;
}
