import * as THREE from 'three';
import type { VesselState, PartState } from '../../sim/vessel/runtime';
import type { EngineModule } from '../../sim/vessel/types';
import { buildPartMesh, createPlume, getExhaustAnchors, setPartDeploy, setEngineGimbal, type Plume } from '../parts';
import type { Vec3 } from '../../util/vec3';

interface PartVisual {
  uid: number;
  object: THREE.Object3D;
  plumes: Plume[];
  deploy: number;
}

/**
 * Renders one vessel. The group is placed at (vessel COM − floating origin) with the vessel's attitude; parts are
 * offset by −COM so the craft frame lines up with the simulation exactly.
 */
export class VesselView {
  readonly root = new THREE.Group();
  private inner = new THREE.Group();
  private parts = new Map<number, PartVisual>();
  private lastPartCount = -1;

  constructor(private vessel: VesselState) {
    this.root.add(this.inner);
    this.rebuild();
  }

  get id() {
    return this.vessel.id;
  }

  setVessel(v: VesselState) {
    this.vessel = v;
  }

  private rebuild() {
    const alive = new Set(this.vessel.parts.map((p) => p.uid));
    for (const [uid, pv] of this.parts) {
      if (!alive.has(uid)) {
        this.inner.remove(pv.object);
        pv.plumes.forEach((pl) => pl.dispose());
        this.parts.delete(uid);
      }
    }
    for (const p of this.vessel.parts) {
      if (this.parts.has(p.uid)) continue;
      const obj = buildPartMesh(p.def);
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
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
      this.parts.set(p.uid, { uid: p.uid, object: obj, plumes, deploy: 0 });
    }
    this.lastPartCount = this.vessel.parts.length;
  }

  update(origin: Vec3, time: number, ambientPressure: number, dt: number) {
    const v = this.vessel;
    if (v.parts.length !== this.lastPartCount) this.rebuild();
    this.root.position.set(v.position.x - origin.x, v.position.y - origin.y, v.position.z - origin.z);
    this.root.quaternion.set(v.orientation.x, v.orientation.y, v.orientation.z, v.orientation.w);
    this.inner.position.set(-v.com.x, -v.com.y, -v.com.z);
    for (const p of v.parts) {
      const pv = this.parts.get(p.uid);
      if (!pv) continue;
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
    if (p.engine) {
      const thr = p.engine.ignited && !p.engine.flamedOut ? p.engine.throttle : 0;
      for (const pl of pv.plumes) pl.update({ throttle: thr, ambientPressure, time });
      setEngineGimbal(pv.object, p.engine.gimbal.a, p.engine.gimbal.b);
    }
    let target = -1;
    if (p.leg) target = p.leg.deployed ? 1 : 0;
    if (p.chute) target = p.chute.phase === 'full' ? 1 : p.chute.phase === 'semi' ? 0.35 : 0;
    if (target >= 0 && Math.abs(pv.deploy - target) > 1e-3) {
      pv.deploy += Math.sign(target - pv.deploy) * Math.min(Math.abs(target - pv.deploy), dt * 0.6);
      setPartDeploy(pv.object, pv.deploy);
    }
  }

  dispose() {
    for (const pv of this.parts.values()) pv.plumes.forEach((pl) => pl.dispose());
    this.root.removeFromParent();
  }
}
