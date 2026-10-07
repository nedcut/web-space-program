import { lampMaterials, untintedMaterials } from './materialState';
import { buildFramework, buildBay, buildHabitat, buildPowerUnit, buildRcsPorts, buildNuclearEngine, buildRadialEngine, buildAerospike } from './builders/expedition';
import { buildISRU } from './builders/isru';
import { buildInstrument } from './builders/science';
import { buildAstronaut } from './builders/astronaut';
import * as THREE from 'three';
import type { PartDef } from '../../sim/vessel/types';
import type { Builder } from './builders/common';
import { buildFin, buildWing, buildControlSurface } from './builders/aero';
import { buildCockpit, buildFuselage, buildGear, buildIntake, buildJetEngine } from './builders/aircraft';
import { buildPod, buildProbeCore } from './builders/command';
import { buildBattery, buildSolarDeploy, buildSolarFixed } from './builders/electrical';
import { buildEngine, buildIonEngine, buildSrb } from './builders/engines';
import {
  buildAdapter,
  buildDecoupler,
  buildFairing,
  buildGirder,
  buildMonoSphere,
  buildMonoTorus,
  buildNoseCone,
  buildRadialDecoupler,
  buildSeparator,
  buildStrut,
  buildTank,
  buildXenonTank,
} from './builders/structure';
import { buildDockingPort, buildHeatShield, buildLandingLeg, buildLight, buildParachute, buildRcsQuad, buildReactionWheel } from './builders/utility';
import { disposeMaterials, M } from './materials';
import { withDetail, type DeployData } from './geom';
import { optimizePartTemplate } from './optimize';
import { bakePartAO } from './ao';

export { createPlume, type Plume, type PlumeParams, type PlumeOptions } from './plume';
export { disposeMaterials } from './materials';
export { partTexturesReady } from './textures';
export { setGearPose } from './builders/aircraft';
export { bakeEngineSoot, prepareEngineSoot, releaseSoot, isSooted } from './soot';

/**
 * Procedural part meshes.
 *
 * Frame: +Y = nose, origin at the part's geometric centre, matching PartDef.attachNodes exactly.
 * Named sub-objects for animation/effects:
 *  - 'gimbal'          engines: rotate for thrust vectoring (see setEngineGimbal); may be several
 *  - 'exhaustAnchor'   nozzle exit plane; +Y = thrust direction, plume extends along -Y;
 *                      userData.exitRadius (m)
 *  - 'controlSurface'  hinged flap; userData.hingeAxis (local axis) — see setControlDeflection
 *  - 'legUpper' / 'legLower' / 'legFoot'      landing legs
 *  - 'panelWing' / 'panel0..n'                deployable solar arrays
 *  - 'chuteCanopy' (+ 'chuteLines')           parachutes (hidden until deployed)
 *  - 'fairingShell' / 'fairingHalfA' / 'fairingHalfB'
 *  - 'lightLens' / 'lightAnchor'              lamps (anchor looks along +Z)
 *  - 'ionGrid'                                ion engine grid (emissive)
 *  - 'gearStrut' / 'gearSlide' / 'gearSteer' / 'gearWheel'   landing gear (see setGearPose)
 * Deployables carry JSON userData.deploy and are driven by setPartDeploy(root, t), t in [0,1].
 */
export const MESH_BUILDERS: Record<string, Builder> = {
  framework: buildFramework, bay: buildBay, habitat: buildHabitat, powerUnit: buildPowerUnit, rcsPorts: buildRcsPorts,
  nuclearEngine: buildNuclearEngine, radialEngine: buildRadialEngine, aerospike: buildAerospike,
  isru: buildISRU,
  instrument: buildInstrument,
  astronaut: buildAstronaut,
  pod: buildPod,
  probeCore: buildProbeCore,
  tank: buildTank,
  monoSphere: buildMonoSphere,
  monoTorus: buildMonoTorus,
  xenonTank: buildXenonTank,
  engine: buildEngine,
  srb: buildSrb,
  ionEngine: buildIonEngine,
  decoupler: buildDecoupler,
  separator: buildSeparator,
  radialDecoupler: buildRadialDecoupler,
  adapter: buildAdapter,
  noseCone: buildNoseCone,
  fairing: buildFairing,
  girder: buildGirder,
  strut: buildStrut,
  fin: buildFin,
  wing: buildWing,
  controlSurface: buildControlSurface,
  rcsQuad: buildRcsQuad,
  reactionWheel: buildReactionWheel,
  battery: buildBattery,
  solarFixed: buildSolarFixed,
  solarDeploy: buildSolarDeploy,
  parachute: buildParachute,
  heatShield: buildHeatShield,
  landingLeg: buildLandingLeg,
  light: buildLight,
  jetEngine: buildJetEngine,
  intake: buildIntake,
  cockpit: buildCockpit,
  fuselage: buildFuselage,
  gear: buildGear,
  dockingPort: buildDockingPort,
};

function fallback(def: PartDef): THREE.Object3D {
  const g =
    def.shape.kind === 'cylinder'
      ? new THREE.CylinderGeometry(def.shape.radiusTop, def.shape.radiusBottom, def.shape.height, 24)
      : new THREE.BoxGeometry(def.shape.size.x, def.shape.size.y, def.shape.size.z);
  const m = new THREE.Mesh(g, M.greyPanel());
  const root = new THREE.Group();
  root.add(m);
  return root;
}

const templates = new Map<string, THREE.Object3D>();

/** Part mesh level of detail: 'high' (default) or 'low' (half tessellation, no decals). */
export type PartDetail = 'high' | 'low';
let defaultDetail: PartDetail = 'high';
/** Default detail for subsequently built part meshes (driven by the quality preset). */
export function setPartDetail(d: PartDetail) {
  defaultDetail = d;
}

/**
 * Build (or clone from cache) the mesh for a part. Clones share geometry and materials, so they
 * are cheap; do not dispose their geometries individually — call disposePartMeshCache().
 */
export function buildPartMesh(def: PartDef, detail: PartDetail = defaultDetail): THREE.Object3D {
  const key = detail === 'high' ? def.id : `${def.id}:low`;
  let t = templates.get(key);
  if (!t) {
    const builder = MESH_BUILDERS[def.mesh] ?? fallback;
    t = withDetail(detail === 'high' ? 1 : 0.5, () => builder(def));
    bakePartAO(t);
    optimizePartTemplate(t);
    t.name = def.id;
    t.userData.partId = def.id;
    setPartDeploy(t, 0);
    templates.set(key, t);
  }
  return t.clone(true);
}

export function disposePartMeshCache() {
  for (const t of templates.values())
    t.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  templates.clear();
  disposeMaterials();
}

const lerp3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Drive all deployables (legs, solar arrays, chutes) in a part mesh. t = 0 stowed, 1 deployed. */
const _aim = new THREE.Vector3();
export function setPartDeploy(root: THREE.Object3D, t: number) {
  const k = Math.max(0, Math.min(1, t));
  let links: THREE.Object3D[] | undefined;
  root.traverse((o) => {
    const d = o.userData.deploy as DeployData | undefined;
    if (!d) return;
    if (d.pos0 && d.pos1) o.position.fromArray(lerp3(d.pos0, d.pos1, k));
    if (d.rot0 && d.rot1) o.rotation.fromArray(lerp3(d.rot0, d.rot1, k));
    if (d.scale0 && d.scale1) o.scale.fromArray(lerp3(d.scale0, d.scale1, k));
    if (d.visibleAbove !== undefined) o.visible = k > d.visibleAbove;
    if (d.aim) (links ??= []).push(o);
  });
  if (!links) return;
  // Telescoping links follow their (already posed) attach points exactly.
  root.updateMatrixWorld(true);
  for (const o of links) {
    const d = o.userData.deploy as DeployData;
    const target = root.getObjectByName(d.aim!);
    if (!target || !o.parent) continue;
    o.parent.worldToLocal(target.getWorldPosition(_aim)).sub(o.position);
    o.rotation.set(Math.atan2(_aim.z, _aim.y), 0, 0);
    const len = Math.hypot(_aim.y, _aim.z);
    let stage: THREE.Object3D | undefined = o.children.find((c) => c.name === 'braceStage');
    const stages: THREE.Object3D[] = [];
    while (stage) { stages.push(stage); stage = stage.children.find((c) => c.name === 'braceStage'); }
    for (const st of stages) st.position.y = Math.max(0, (len - (d.tube ?? 0)) / Math.max(1, stages.length));
  }
}

/**
 * Lamp lens appearance (on/off, colour). The lens gets its own material clone on first use so colours stay per part;
 * editor tint bookkeeping in weak maps follows the clone without JSON-serializing textures.
 */
export function setLightAppearance(root: THREE.Object3D, on: boolean, color = '#fff1cf') {
  delete root.userData.editorTint;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.name !== 'lightLens') return;
    let mat = lampMaterials.get(mesh);
    if (!mat) {
      const prev = (untintedMaterials.get(mesh) ?? mesh.material) as THREE.MeshStandardMaterial;
      mat = prev.clone();
      mat.onBeforeCompile = prev.onBeforeCompile;
      mat.customProgramCacheKey = prev.customProgramCacheKey;
      lampMaterials.set(mesh, mat);
      if (mesh.material === prev) mesh.material = mat;
      if (untintedMaterials.has(mesh)) untintedMaterials.set(mesh, mat);
    } else if (!untintedMaterials.has(mesh) && mesh.material !== mat) mesh.material = mat;
    mat.emissive.set(color);
    mat.emissiveIntensity = on ? 2.5 : 0;
    mat.color.set(on ? color : '#8a8f96');
  });
}

/** Set thrust-vector angles (radians) on every 'gimbal' node: pitch about X, yaw about Z. */
export function setEngineGimbal(root: THREE.Object3D, pitch: number, yaw: number) {
  root.traverse((o) => {
    if (o.name === 'gimbal') o.rotation.set(pitch, 0, yaw);
  });
}

const _axis = new THREE.Vector3();
/** Deflect every 'controlSurface' node about its hinge axis (radians). */
export function setControlDeflection(root: THREE.Object3D, angle: number) {
  root.traverse((o) => {
    if (o.name !== 'controlSurface') return;
    const a = o.userData.hingeAxis as [number, number, number] | undefined;
    if (!a) return;
    o.quaternion.setFromAxisAngle(_axis.fromArray(a), angle);
  });
}

/** All nozzle exit anchors in a part mesh. */
export function getExhaustAnchors(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name === 'exhaustAnchor') out.push(o);
  });
  return out;
}
