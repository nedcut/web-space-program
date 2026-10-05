import * as THREE from 'three';
import type { PartState } from '../../sim/vessel/runtime';

/** Own only material clones, never shared template geometry/textures. */
export class PartHeat {
  private readonly materials: { material: THREE.MeshStandardMaterial; base: THREE.Color; intensity: number; nozzle: boolean }[] = [];
  private nozzleTemperature = 290;
  private readonly color = new THREE.Color();
  constructor(object: THREE.Object3D) {
    const clones = new Map<string, THREE.MeshStandardMaterial>();
    object.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const nozzle = /bell|nozzle/i.test(o.name);
      const clone = (m: THREE.Material) => {
        if (!(m instanceof THREE.MeshStandardMaterial)) return m;
        const key = `${m.uuid}:${nozzle}`;
        let owned = clones.get(key);
        if (!owned) {
          owned = m.clone(); clones.set(key, owned);
          this.materials.push({ material: owned, base: m.emissive.clone(), intensity: m.emissiveIntensity, nozzle });
        }
        return owned;
      };
      o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
    });
  }
  update(p: PartState, dt: number) {
    let temperature = 0;
    for (let i = 0; i < p.skinTemperature.length; i++) temperature = Math.max(temperature, p.skinTemperature[i]);
    const burning = p.engine && p.engine.thrust > 0;
    const target = burning ? 1350 : 290;
    this.nozzleTemperature += (target - this.nozzleTemperature) * (1 - Math.exp(-Math.max(0, dt) / (burning ? 2 : 12)));
    for (const m of this.materials) {
      const t = m.nozzle ? Math.max(temperature, this.nozzleTemperature) : temperature;
      blackbody(t, this.color);
      const strength = Math.min(12, Math.pow(Math.max(0, t - 700) / 850, 2));
      m.material.emissive.copy(this.color).multiplyScalar(strength);
      m.material.emissive.r += m.base.r * m.intensity;
      m.material.emissive.g += m.base.g * m.intensity;
      m.material.emissive.b += m.base.b * m.intensity;
      m.material.emissiveIntensity = 1;
    }
  }
  dispose() { for (const m of this.materials) m.material.dispose(); }
}

/** Blackbody approximation (Kelvin), linearized for HDR emission. */
export function blackbody(kelvin: number, out: THREE.Color): THREE.Color {
  const t = THREE.MathUtils.clamp(kelvin, 800, 12000) / 100;
  const r = t <= 66 ? 255 : 329.698727 * Math.pow(t - 60, -0.13320476);
  const g = t <= 66 ? 99.470802 * Math.log(t) - 161.119568 : 288.12217 * Math.pow(t - 60, -0.07551485);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.517731 * Math.log(t - 10) - 305.044793;
  return out.setRGB(Math.min(1, Math.max(0, r / 255)), Math.min(1, Math.max(0, g / 255)), Math.min(1, Math.max(0, b / 255)), THREE.SRGBColorSpace);
}
