import * as THREE from 'three';
import type { QualitySettings } from '../core/quality';
import type { PlanetUniforms } from './uniforms';
import { mulberry32 } from '../../sim/terrain/noise';
import { GLSL_LOGDEPTH_VERT_PARS, GLSL_LOGDEPTH_VERT, GLSL_LOGDEPTH_FRAG_PARS, GLSL_LOGDEPTH_FRAG } from '../core/glsl';

/** Cell coordinates remain float64 on the CPU; only offsets from the local cell origin reach the GPU. */
export function ringCellSeed(x: number, y: number): number {
  return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ 0x51a7) >>> 0;
}

export function ringProfileAt(data: ArrayLike<number>, inner: number, outer: number, radius: number): number {
  const u = (radius - inner) / (outer - inner);
  if (u < 0 || u > 1) return 0;
  const px = Math.max(0, Math.min(data.length / 4 - 1, u * data.length / 4 - 0.5));
  const i = Math.floor(px), j = Math.min(i + 1, data.length / 4 - 1);
  return (data[i * 4 + 3] * (1 - (px - i)) + data[j * 4 + 3] * (px - i)) / 255;
}

export interface RingChunk { x: number; y: number; z: number; size: number; seed: number }
/** Stateless cell generation keeps overlapping cells identical after travel, origin shifts and reloads. */
export function ringCell(x: number, y: number, cellSize: number, count: number, density: (radius: number) => number): RingChunk[] {
  const seed = ringCellSeed(x, y), rnd = mulberry32(seed);
  const chunks: RingChunk[] = [];
  for (let i = 0; i < count; i++) {
    const px = (x + rnd()) * cellSize, py = (y + rnd()) * cellSize;
    const z = (rnd() - 0.5) * 45, size = 0.6 + Math.pow(rnd(), 4) * 10;
    if (rnd() < density(Math.hypot(px, py))) chunks.push({ x: px, y: py, z, size, seed: seed + i });
  }
  return chunks;
}

export class RingParticles {
  readonly group = new THREE.Group();
  readonly range: number;
  private readonly meshes: THREE.InstancedMesh[];
  private readonly material: THREE.ShaderMaterial;
  private readonly cellSize = 160;
  private readonly reach: number;
  private readonly chunksPerCell: number;
  private cx = NaN;
  private cy = NaN;
  private chunks: RingChunk[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly camLocal = new THREE.Vector3();

  constructor(u: PlanetUniforms, quality: QualitySettings, private profile: Uint8Array, private inner: number, private outer: number) {
    this.reach = quality.planetDetails.ringCells;
    this.chunksPerCell = quality.planetDetails.ringChunksPerCell;
    this.range = this.cellSize * this.reach;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...u, uRange: { value: this.range }, uCamLocal: { value: this.camLocal } },
      vertexShader: /* glsl */ `
        ${GLSL_LOGDEPTH_VERT_PARS}
        uniform mat3 uBodyRot;
        varying vec3 vNormal, vWorld, vLocal;
        void main() {
          vec4 p = instanceMatrix * vec4(position, 1.0);
          vLocal = p.xyz;
          mat3 basis = mat3(instanceMatrix);
          vec3 squaredScale = vec3(dot(basis[0], basis[0]), dot(basis[1], basis[1]), dot(basis[2], basis[2]));
          vNormal = normalize(uBodyRot * basis * (normal / squaredScale));
          vec4 wp = modelMatrix * p;
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          ${GLSL_LOGDEPTH_VERT}
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_LOGDEPTH_FRAG_PARS}
        uniform vec3 uSunDir, uSunColor, uPlanetCenter, uCamLocal;
        uniform float uPlanetRadius, uRange;
        varying vec3 vNormal, vWorld, vLocal;
        void main() {
          ${GLSL_LOGDEPTH_FRAG}
          float distanceFade = 1.0 - smoothstep(uRange * 0.65, uRange, distance(vLocal, uCamLocal));
          // Ordered screen-door fade retains opaque depth and avoids sorting thousands of chunks.
          float dither = fract(dot(floor(gl_FragCoord.xy), vec2(0.75487766, 0.56984029)));
          if (distanceFade < dither) discard;
          vec3 rel = vWorld - uPlanetCenter;
          float along = dot(rel, uSunDir);
          float shadow = along < 0.0 ? smoothstep(uPlanetRadius * 0.99, uPlanetRadius * 1.01, length(rel - along * uSunDir)) : 1.0;
          vec3 V = normalize(cameraPosition - vWorld);
          float forward = pow(max(dot(-V, uSunDir), 0.0), 12.0);
          float diffuse = max(dot(normalize(vNormal), uSunDir), 0.0);
          float planetPhase = 0.5 + 0.5 * dot(normalize(rel), uSunDir);
          float shine = 0.10 * pow(uPlanetRadius / length(rel), 2.0) * planetPhase;
          vec3 ice = mix(vec3(0.38, 0.32, 0.24), vec3(0.82, 0.88, 0.91), 0.7 + 0.2 * vNormal.z);
          gl_FragColor = vec4(ice * uSunColor * ((diffuse * 0.8 + forward * 0.35) * shadow + shine + 0.006) / 3.14159265, 1.0);
        }`,
    });
    const capacity = (this.reach * 2 + 1) ** 2 * this.chunksPerCell;
    this.meshes = [1, 0].map((detail) => {
      const geo = new THREE.IcosahedronGeometry(1, detail);
      const p = geo.getAttribute('position');
      // Continuous deformation: duplicated triangle vertices receive identical offsets (no cracks).
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const s = 1 + 0.18 * Math.sin(x * 9 + y * 5) * Math.cos(z * 7 - x * 3);
        p.setXYZ(i, x * s, y * s, z * s);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.InstancedMesh(geo, this.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      return mesh;
    });
  }

  update(cameraBF: THREE.Vector3, bodyCenter: THREE.Vector3, rotation: THREE.Quaternion): void {
    const r = Math.hypot(cameraBF.x, cameraBF.y);
    this.group.visible = Math.abs(cameraBF.z) < this.range && r > this.inner - this.range && r < this.outer + this.range;
    if (!this.group.visible) return;
    const cx = Math.floor(cameraBF.x / this.cellSize), cy = Math.floor(cameraBF.y / this.cellSize);
    if (cx !== this.cx || cy !== this.cy) {
      this.cx = cx; this.cy = cy;
      this.chunks = [];
      const density = (radius: number) => ringProfileAt(this.profile, this.inner, this.outer, radius);
      for (let y = cy - this.reach; y <= cy + this.reach; y++) {
        for (let x = cx - this.reach; x <= cx + this.reach; x++) this.chunks.push(...ringCell(x, y, this.cellSize, this.chunksPerCell, density));
      }
    }
    this.anchor.set(cx * this.cellSize, cy * this.cellSize, 0);
    this.camLocal.copy(cameraBF).sub(this.anchor);
    // Matrix translation is evaluated in JS float64 before conversion to float32 by three.js.
    this.group.position.copy(this.anchor).applyQuaternion(rotation).add(bodyCenter);
    this.group.quaternion.copy(rotation);
    const counts = [0, 0];
    for (const p of this.chunks) {
      const d = Math.hypot(p.x - cameraBF.x, p.y - cameraBF.y, p.z - cameraBF.z);
      if (d > this.range) continue;
      const lod = d < 230 ? 0 : 1;
      const rnd = mulberry32(p.seed);
      this.pos.set(p.x - this.anchor.x, p.y - this.anchor.y, p.z);
      this.rotation.setFromEuler(new THREE.Euler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28));
      this.scale.set(p.size * (0.6 + rnd()), p.size * (0.5 + rnd()), p.size * (0.5 + rnd()));
      this.matrix.compose(this.pos, this.rotation, this.scale);
      this.meshes[lod].setMatrixAt(counts[lod]++, this.matrix);
    }
    this.meshes.forEach((mesh, i) => { mesh.count = counts[i]; mesh.instanceMatrix.needsUpdate = true; });
  }

  dispose(): void {
    this.meshes.forEach((m) => m.geometry.dispose());
    this.material.dispose();
    this.group.removeFromParent();
  }
}
