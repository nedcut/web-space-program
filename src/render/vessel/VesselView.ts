import { LinkView } from './LinkView';
import { PartHeat } from '../fx/PartHeat';
import { batchStaticParts, disposeStaticBatch } from './staticBatch';
import * as THREE from 'three';
import type { VesselState, PartState } from '../../sim/vessel/runtime';
import type { EngineModule } from '../../sim/vessel/types';
import { buildPartMesh, createPlume, getExhaustAnchors, setLightAppearance, setPartDeploy, setEngineGimbal, setGearPose, type Plume } from '../parts';
import { qRotate } from '../../util/quat';
import type { Vec3 } from '../../util/vec3';

interface PartVisual {
  heat: PartHeat;
  uid: number;
  object: THREE.Object3D;
  plumes: Plume[];
  deploy: number;
  static: boolean;
  partId: string;
  surfaces: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  stressMaterial?: THREE.MeshBasicMaterial;
}

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

  constructor(private vessel: VesselState) {
    this.root.add(this.inner, this.impostor);
    this.inner.add(this.links.root);
    this.impostor.visible = false;
    this.rebuild();
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

  setVessel(v: VesselState) {
    this.vessel = v;
  }

  private rebuild() {
    if (this.batch) disposeStaticBatch(this.batch);
    // Restore static leaves hidden by the previous batch before regrouping after staging/docking.
    for (const pv of this.parts.values()) pv.object.traverse(o => { if (o.userData.batchedVisible) { o.visible = true; delete o.userData.batchedVisible; } });
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
      const obj = buildPartMesh(p.def);
      const surfaces = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const mesh = o as THREE.Mesh;
          surfaces.set(mesh, mesh.material);
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const heat = new PartHeat(obj);
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
      this.parts.set(p.uid, { heat, uid: p.uid, partId: p.partId, object: obj, plumes, surfaces, deploy: 0, static: false });
    }
    const staticObjects: THREE.Object3D[] = [];
    const staticKinds = new Set(['tank', 'adapter', 'girder', 'strut', 'noseCone', 'battery', 'reactionWheel', 'probeCore', 'heatShield', 'monoSphere', 'monoTorus', 'xenonTank', 'framework', 'habitat', 'rcsQuad', 'rcsPorts', 'instrument', 'decoupler', 'separator', 'radialDecoupler']);
    for (const p of this.vessel.parts) {
      const obj = this.parts.get(p.uid)!.object;
      obj.position.set(p.position.x, p.position.y, p.position.z);
      obj.quaternion.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w);
      const pv = this.parts.get(p.uid)!;
      pv.static = staticKinds.has(p.def.mesh);
      if (this.stressOverlay) {
        pv.stressMaterial ??= new THREE.MeshBasicMaterial({ color: 0x44cc55 });
        for (const mesh of pv.surfaces.keys()) mesh.material = pv.stressMaterial;
      } else {
        for (const [mesh, material] of pv.surfaces) mesh.material = material;
      }
      if (pv.static && !this.stressOverlay) staticObjects.push(obj);
    }
    this.batch = batchStaticParts(staticObjects);
    this.inner.add(this.batch);
    for (const obj of staticObjects) obj.traverse(o => { o.matrixAutoUpdate = false; });
    this.geometryKey = this.layoutKey();
    this.lastTopology = this.vessel.cache;
  }

  update(origin: Vec3, time: number, ambientPressure: number, dt: number, distant = false) {
    const v = this.vessel;
    this.origin.copy(origin);
    if (v.cache !== this.lastTopology) {
      if (this.geometryKey !== this.layoutKey()) this.rebuild();
      this.lastTopology = v.cache;
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
    if (!this.stressOverlay && p.def.modules.some(m => m.type === 'light')) setLightAppearance(pv.object, p.tweaks?.lightOn !== false, p.tweaks?.lightColor);
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
