import { LinkView } from './LinkView';
import { PartHeat } from '../fx/PartHeat';
import { thermalSources } from '../fx/thermalSurface';
import { batchStaticParts, disposeStaticBatch, isAnimatedNode } from './staticBatch';
import * as THREE from 'three';
import type { VesselState, PartState } from '../../sim/vessel/runtime';
import type { EngineModule } from '../../sim/vessel/types';
import { bakeEngineSoot, buildPartMeshVariant, createPlume, partMeshParams, getExhaustAnchors, setLightAppearance, setPartDeploy, setEngineGimbal, setGearPose, type Plume } from '../parts';
import { qRotate } from '../../util/quat';
import type { Vec3 } from '../../util/vec3';

interface PartVisual {
  state: PartState;
  heat: PartHeat;
  uid: number;
  object: THREE.Object3D;
  plumes: Plume[];
  deploy: number;
  static: boolean;
  partId: string;
  surfaces: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  stressMaterial?: THREE.MeshBasicMaterial;
  /** Lamp state last applied (a rebuild restores template materials, so it clears this). */
  lightKey?: string;
}

/**
 * Frames a split/staged/destroyed layout must stay unchanged before it is re-batched. A crash removes parts over
 * several frames and creates a view per fragment; batching each intermediate layout on its event frame stacked
 * ~5–10 ms of geometry merging onto the impact. Until then the parts draw individually (the pre-batch path).
 */
const BATCH_SETTLE_FRAMES = 12;
/** At most one deferred batch per this many ms across all views, so a burst of fragments does not batch at once. */
const BATCH_SPACING_MS = 4;
let lastDeferredBatch = -Infinity;

/**
 * Renders one vessel. The group is placed at (vessel COM − floating origin) with the vessel's attitude; parts are
 * offset by −COM so the craft frame lines up with the simulation exactly.
 */
export class VesselView {
  readonly root = new THREE.Group();
  private readonly origin = new THREE.Vector3();
  private inner = new THREE.Group();
  private parts = new Map<number, PartVisual>();
  private lastTopology?: VesselState['cache'];
  private batch?: THREE.Group;
  /** Frames until the deferred batch may run; 0 = batched (or nothing pending). */
  private batchPending = 0;
  private stressOverlay = false;
  private links = new LinkView();

  setStressOverlay(enabled: boolean) {
    if (this.stressOverlay === enabled) return;
    this.stressOverlay = enabled;
    this.rebuild();
  }

  private geometryKey = '';
  private layoutKey(): string {
    return this.vessel.parts.map(p => `${p.uid}:${p.partId}:${p.position.x},${p.position.y},${p.position.z}:${p.rotation.x},${p.rotation.y},${p.rotation.z},${p.rotation.w}`).join('|');
  }
  private readonly impostor = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), new THREE.PointsMaterial({ color: 0xbcc9d8, size: 3, sizeAttenuation: false }));

  constructor(private vessel: VesselState, donors?: Iterable<VesselView>) {
    // Splits preserve PartState identity. Move the existing visuals (including thermal state, plumes and
    // soot) before the donor rebuild removes them; never match unrelated vessels by their local UID.
    if (donors) for (const donor of donors) for (const p of vessel.parts) {
      const pv = donor.parts.get(p.uid);
      if (pv?.state !== p) continue;
      donor.parts.delete(p.uid);
      donor.lastTopology = undefined;
      this.parts.set(p.uid, pv);
      this.inner.add(pv.object);
    }
    this.root.add(this.inner, this.impostor);
    this.inner.add(this.links.root);
    this.impostor.visible = false;
    // A split piece adopts already-drawn visuals: draw them unbatched until the breakup settles.
    this.rebuild(this.parts.size > 0);
  }

  get id() {
    return this.vessel.id;
  }

  /** Last rendered part location remains available when the sim has already removed it. */
  partPosition(uid: number, out: THREE.Vector3): boolean {
    const part = this.parts.get(uid);
    if (!part) return false;
    part.object.getWorldPosition(out).add(this.origin);
    return true;
  }

  /** Event snapshot remains available after the authority removes a part. */
  eventPart(uid: number) { return this.parts.get(uid)?.state; }

  debrisGeometry(uid: number): THREE.BufferGeometry | undefined {
    let geometry: THREE.BufferGeometry | undefined;
    this.parts.get(uid)?.object.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !geometry && !mesh.name.includes('plume')) geometry = thermalSources.get(mesh.geometry)?.source ?? mesh.geometry;
    });
    return geometry;
  }

  setVessel(v: VesselState) {
    this.vessel = v;
  }

  private rebuild(defer = false) {
    if (this.batch) disposeStaticBatch(this.batch);
    this.batch = undefined;
    // Restore static leaves hidden by the previous batch before regrouping after staging/docking.
    for (const pv of this.parts.values()) pv.object.traverse(o => { if (o.userData.batchedVisible) { o.visible = true; o.matrixWorldAutoUpdate = true; delete o.userData.batchedVisible; } });
    let needsSoot = false;
    const alive = new Set(this.vessel.parts.map((p) => p.uid));
    for (const [uid, pv] of this.parts) {
      if (!alive.has(uid) || this.vessel.cache.byUid.get(uid)?.partId !== pv.partId) {
        pv.heat.dispose();
        this.inner.remove(pv.object);
        pv.plumes.forEach((pl) => pl.dispose());
        pv.stressMaterial?.dispose();
        this.parts.delete(uid);
      }
    }
    for (const p of this.vessel.parts) {
      if (this.parts.has(p.uid)) continue;
      needsSoot = true;
      const obj = buildPartMeshVariant(p.def, partMeshParams(p.def, p.tweaks));
      const heat = new PartHeat(obj);
      const surfaces = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const mesh = o as THREE.Mesh;
          surfaces.set(mesh, mesh.material);
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const plumes: Plume[] = [];
      const eng = p.def.modules.find((m): m is EngineModule => m.type === 'engine');
      if (eng) {
        for (const a of getExhaustAnchors(obj)) {
          const pl = createPlume({ type: eng.plume, exitRadius: (a.userData.exitRadius as number) ?? 0.4, seed: p.uid });
          a.add(pl.object);
          plumes.push(pl);
        }
      }
      this.inner.add(obj);
      this.parts.set(p.uid, { state: p, heat, uid: p.uid, partId: p.partId, object: obj, plumes, surfaces, deploy: 0, static: false });
    }
    const staticKinds = new Set(['tank', 'adapter', 'girder', 'strut', 'noseCone', 'battery', 'reactionWheel', 'probeCore', 'heatShield', 'monoSphere', 'monoTorus', 'xenonTank', 'framework', 'habitat', 'rcsQuad', 'rcsPorts', 'instrument', 'decoupler', 'separator', 'radialDecoupler']);
    for (const p of this.vessel.parts) {
      const pv = this.parts.get(p.uid)!;
      const obj = pv.object;
      needsSoot ||= obj.position.x !== p.position.x || obj.position.y !== p.position.y || obj.position.z !== p.position.z
        || obj.quaternion.x !== p.rotation.x || obj.quaternion.y !== p.rotation.y || obj.quaternion.z !== p.rotation.z || obj.quaternion.w !== p.rotation.w;
      pv.state = p;
      obj.position.set(p.position.x, p.position.y, p.position.z);
      obj.quaternion.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w);
      // A previous batch froze static parts' local matrices; they draw individually until the next batch.
      if (!obj.matrixAutoUpdate) obj.updateMatrix();
      pv.static = staticKinds.has(p.def.mesh);
      pv.lightKey = undefined;
      if (this.stressOverlay) {
        pv.stressMaterial ??= new THREE.MeshBasicMaterial({ color: 0x44cc55 });
        for (const mesh of pv.surfaces.keys()) mesh.material = pv.stressMaterial;
      } else {
        for (const [mesh, material] of pv.surfaces) mesh.material = material;
      }
    }
    // Soot follows the current engine layout (PartHeat already gave every part its own geometry copy).
    // Separation does not wash off accumulated staining. Only a new/moved layout needs a bake.
    if (needsSoot) bakeEngineSoot([...this.parts.values()].map(pv => pv.object), this.inner);
    this.geometryKey = this.layoutKey();
    this.lastTopology = this.vessel.cache;
    this.batchPending = 0;
    if (this.stressOverlay) return;
    if (defer) this.batchPending = BATCH_SETTLE_FRAMES;
    else this.batchParts();
  }

  private batchParts() {
    this.batchPending = 0;
    const staticObjects: THREE.Object3D[] = [];
    // Animated parts (engines, panels, pods with lamps...) still have mostly rigid meshes: batch those too.
    const rigidObjects: THREE.Object3D[] = [];
    for (const p of this.vessel.parts) {
      const pv = this.parts.get(p.uid);
      if (!pv) continue;
      if (pv.static) staticObjects.push(pv.object);
      else if (!this.vessel.eva) rigidObjects.push(pv.object);
    }
    this.batch = batchStaticParts([...staticObjects, ...rigidObjects], isAnimatedNode);
    this.inner.add(this.batch);
    for (const obj of staticObjects) obj.traverse(o => { o.matrixAutoUpdate = false; });
  }

  update(origin: Vec3, time: number, ambientPressure: number, dt: number, distant = false) {
    const v = this.vessel;
    this.origin.copy(origin);
    if (v.cache !== this.lastTopology) {
      if (this.geometryKey !== this.layoutKey()) this.rebuild(true);
      this.lastTopology = v.cache;
    }
    if (this.batchPending > 0 && --this.batchPending === 0) {
      if (performance.now() - lastDeferredBatch < BATCH_SPACING_MS) this.batchPending = 1;
      else { this.batchParts(); lastDeferredBatch = performance.now(); }
    }
    this.root.position.set(v.position.x - origin.x, v.position.y - origin.y, v.position.z - origin.z);
    this.root.quaternion.set(v.orientation.x, v.orientation.y, v.orientation.z, v.orientation.w);
    this.inner.visible = !distant;
    this.impostor.visible = distant;
    if (distant) return;
    this.inner.position.set(-v.com.x, -v.com.y, -v.com.z);
    this.links.update(v.parts);
    for (const p of v.parts) {
      const pv = this.parts.get(p.uid);
      if (!pv) continue;
      pv.heat.update(p, dt);
      if (this.stressOverlay && pv.stressMaterial) {
        const load = v.cache.jointLoads?.get(p.uid)?.fraction ?? 0;
        pv.stressMaterial.color.setHSL((1 - Math.min(1, load)) / 3, 0.85, 0.5);
      }
      if (pv.static) continue;
      pv.object.position.set(p.position.x, p.position.y, p.position.z);
      pv.object.quaternion.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w);
      this.animatePart(p, pv, time, ambientPressure, dt);
    }
  }

  private animatePart(p: PartState, pv: PartVisual, time: number, ambientPressure: number, dt: number) {
    const eva = this.vessel.eva;
    if (eva) {
      for (const side of [-1, 1]) {
        const swing = eva.walking ? Math.sin(eva.walkPhase) * 0.48 * side : 0;
        pv.object.getObjectByName(`arm${side}`)!.rotation.x = -swing;
        pv.object.getObjectByName(`leg${side}`)!.rotation.x = swing;
        const puff = pv.object.getObjectByName(`evaPuff${side}`)!;
        puff.visible = eva.jetting;
        puff.scale.setScalar(0.8 + 0.2 * Math.sin(time * 41 + side));
      }
    }
    if (!this.stressOverlay && p.def.modules.some(m => m.type === 'light')) {
      const on = p.tweaks?.lightOn !== false, key = `${on}:${p.tweaks?.lightColor ?? ''}`;
      if (pv.lightKey !== key) { pv.lightKey = key; setLightAppearance(pv.object, on, p.tweaks?.lightColor); }
    }
    if (p.engine) {
      const thr = p.engine.ignited && !p.engine.flamedOut ? p.engine.throttle : 0;
      for (const pl of pv.plumes) pl.update({ throttle: thr, ambientPressure, time });
      setEngineGimbal(pv.object, p.engine.gimbal.a, p.engine.gimbal.b);
    }
    if (p.wheel) {
      // Gear deploy follows the simulated animation; steering sign converts body-frame steer to the part frame.
      if (Math.abs(pv.deploy - p.wheel.deploy) > 1e-4) {
        pv.deploy = p.wheel.deploy;
        setPartDeploy(pv.object, pv.deploy);
      }
      const sx = qRotate(p.rotation, { x: 1, y: 0, z: 0 }).x;
      setGearPose(pv.object, p.wheel.compression, sx >= 0 ? -p.wheel.steer : p.wheel.steer, p.wheel.spin);
      return;
    }
    if (p.drillDeploy !== undefined) {
      pv.deploy = p.drillDeploy;
      setPartDeploy(pv.object, pv.deploy);
      return;
    }
    let target = -1;
    if (p.bayOpen !== undefined) target = p.bayOpen ? 1 : 0;
    if (p.leg) target = p.leg.deployed ? 1 : 0;
    if (p.chute) target = p.chute.phase === 'full' ? 1 : p.chute.phase === 'semi' ? 0.35 : 0;
    // Retractable solar arrays follow their extended setting (catalogue default: extended).
    if (p.def.modules.some(m => m.type === 'solarPanel' && m.tracking)) target = p.tweaks?.extended === false ? 0 : 1;
    if (target >= 0 && Math.abs(pv.deploy - target) > 1e-3) {
      pv.deploy += Math.sign(target - pv.deploy) * Math.min(Math.abs(target - pv.deploy), dt * 0.6);
      setPartDeploy(pv.object, pv.deploy);
    }
  }

  dispose() {
    this.links.dispose();
    if (this.batch) disposeStaticBatch(this.batch);
    this.impostor.geometry.dispose(); this.impostor.material.dispose();
    for (const pv of this.parts.values()) {
      pv.heat.dispose();
      pv.plumes.forEach((pl) => pl.dispose());
      pv.stressMaterial?.dispose();
    }
    this.root.removeFromParent();
  }
}
