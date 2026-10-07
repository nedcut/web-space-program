import * as THREE from 'three';
import type { PartState } from '../../sim/vessel/runtime';
import { allocateThermalSlot, releaseThermalSlot, thermalGeometry, thermalMaterial, writeThermalSlot } from './thermalSurface';

/** Per-part radiance in shared dynamic attributes; materials and batching remain shared. */
export class PartHeat {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly slot = allocateThermalSlot();
  private nozzleTemperature = 290;
  private disposed = false;
  private readonly color = new THREE.Color();
  constructor(object: THREE.Object3D) {
    object.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const nozzle = /bell|nozzle/i.test(o.name);
      o.geometry = thermalGeometry(o.geometry, this.slot ? this.slot + Number(nozzle) : 0);
      this.geometries.push(o.geometry);
      o.material = Array.isArray(o.material) ? o.material.map(thermalMaterial) : thermalMaterial(o.material);
    });
  }
  update(p: PartState, dt: number) {
    if (this.disposed) return;
    let temperature = 0;
    for (let i = 0; i < p.skinTemperature.length; i++) temperature = Math.max(temperature, p.skinTemperature[i]);
    const burning = p.engine && p.engine.thrust > 0;
    const target = burning ? 1350 : 290;
    this.nozzleTemperature += (target - this.nozzleTemperature) * (1 - Math.exp(-Math.max(0, dt) / (burning ? 8 : 18)));
    for (let i = 0; i < 2; i++) {
      const t = Math.round(i ? Math.max(temperature, this.nozzleTemperature) : temperature);
      blackbody(t, this.color);
      const strength = Math.min(12, Math.pow(Math.max(0, t - 700) / 850, 2));
      writeThermalSlot(this.slot ? this.slot + i : 0, this.color.multiplyScalar(strength));
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geometries) g.dispose();
    releaseThermalSlot(this.slot);
  }
}

/** Blackbody approximation (Kelvin), linearized for HDR emission. */
export function blackbody(kelvin: number, out: THREE.Color): THREE.Color {
  const t = THREE.MathUtils.clamp(kelvin, 800, 12000) / 100;
  const r = t <= 66 ? 255 : 329.698727 * Math.pow(t - 60, -0.13320476);
  const g = t <= 66 ? 99.470802 * Math.log(t) - 161.119568 : 288.12217 * Math.pow(t - 60, -0.07551485);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.517731 * Math.log(t - 10) - 305.044793;
  return out.setRGB(Math.min(1, Math.max(0, r / 255)), Math.min(1, Math.max(0, g / 255)), Math.min(1, Math.max(0, b / 255)), THREE.SRGBColorSpace);
}
