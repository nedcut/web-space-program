import * as THREE from 'three';
import type { AsteroidSeed } from '../../sim/bodies/asteroidField';
import type { StateVector } from '../../sim/orbit/api';
import type { Vec3 } from '../../util/vec3';
export interface FieldSource {
  asteroidField: AsteroidSeed[];
  asteroidState(id: string, t: number): StateVector;
}
export class AsteroidFieldView {
  readonly points: THREE.Points;
  private line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff4fb8 }));
  private selected: string | null = null;
  constructor(private source: FieldSource, private sunGM: number, private lengthScale: number, scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(source.asteroidField.length * 3), 3));
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xa69b89, size: 3, sizeAttenuation: false }));
    this.points.frustumCulled = false; this.line.frustumCulled = false;
    scene.add(this.points, this.line);
  }
  select(id: string | null) { this.selected = id; }
  setVisible(visible: boolean) {
    this.points.visible = visible;
    if (!visible) this.line.visible = false;
  }
  update(t: number, focus: Vec3) {
    const positions = this.points.geometry.getAttribute('position');
    this.source.asteroidField.forEach((a, i) => {
      const p = this.source.asteroidState(a.id, t).position;
      positions.setXYZ(i, p.x - focus.x, p.y - focus.y, p.z - focus.z);
    });
    positions.needsUpdate = true;
    const selected = this.source.asteroidField.find(a => a.id === this.selected);
    this.line.visible = !!selected;
    if (selected) {
      const period = 2 * Math.PI * Math.sqrt((selected.orbit.a * this.lengthScale) ** 3 / this.sunGM);
      const points = Array.from({ length: 257 }, (_, i) => {
        const p = this.source.asteroidState(selected.id, period * i / 256).position;
        return new THREE.Vector3(p.x - focus.x, p.y - focus.y, p.z - focus.z);
      });
      this.line.geometry.setFromPoints(points);
    }
  }
  pick(x: number, y: number, camera: THREE.Camera): string | null {
    if (!this.points.visible) return null;
    const positions = this.points.geometry.getAttribute('position');
    let best = 0.022 ** 2, id: string | null = null;
    const v = new THREE.Vector3();
    this.source.asteroidField.forEach((a, i) => {
      v.fromBufferAttribute(positions, i).project(camera);
      const d = (v.x - x) ** 2 + (v.y - y) ** 2;
      if (v.z > -1 && v.z < 1 && d < best) { best = d; id = a.id; }
    });
    return id;
  }
}
