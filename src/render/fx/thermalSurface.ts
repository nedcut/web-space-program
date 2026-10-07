import * as THREE from 'three';

// Two texels per part: skin and nozzle. Slot zero is always cold. One shared vertex-stage
// lookup keeps emission independent per part even after static merging / instancing.
const WIDTH = 128;
const HEIGHT = 64;
const values = new Float32Array(WIDTH * HEIGHT * 4);
export const thermalTexture = new THREE.DataTexture(values, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.FloatType);
thermalTexture.name = 'part thermal radiance';
thermalTexture.needsUpdate = true;
const free: number[] = [];
let next = 2;
export function allocateThermalSlot(): number {
  if (free.length) return free.pop()!;
  if (next >= WIDTH * HEIGHT) return 0; // Bounded visual budget; simulation is unaffected.
  const slot = next; next += 2; return slot;
}
export function writeThermalSlot(slot: number, color: THREE.Color): void {
  if (!slot) return;
  const i = slot * 4;
  if (values[i] === Math.fround(color.r) && values[i + 1] === Math.fround(color.g) && values[i + 2] === Math.fround(color.b)) return;
  values[i] = color.r; values[i + 1] = color.g; values[i + 2] = color.b;
  thermalTexture.needsUpdate = true;
}
const cold = new THREE.Color(0, 0, 0);
export function releaseThermalSlot(slot: number): void {
  if (!slot) return;
  writeThermalSlot(slot, cold); writeThermalSlot(slot + 1, cold); free.push(slot);
}

const variants = new WeakMap<THREE.Material, THREE.Material>();
export function thermalMaterial(m: THREE.Material): THREE.Material {
  if (!(m instanceof THREE.MeshStandardMaterial)) return m;
  let variant = variants.get(m);
  if (variant) return variant;
  variant = m.clone();
  variant.name = `${m.name}#thermal`;
  variant.onBeforeCompile = (shader, renderer) => {
    m.onBeforeCompile(shader, renderer);
    shader.uniforms.wspThermal = { value: thermalTexture };
    shader.vertexShader = 'attribute float wspHeatSlot;\nuniform sampler2D wspThermal;\nvarying vec3 wspRadiance;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      wspRadiance = texture2D(wspThermal, (vec2(mod(wspHeatSlot, 128.0), floor(wspHeatSlot / 128.0)) + 0.5) / vec2(128.0, 64.0)).rgb;`);
    shader.fragmentShader = 'varying vec3 wspRadiance;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += wspRadiance;');
  };
  variant.customProgramCacheKey = () => `${m.customProgramCacheKey()}:thermal-v1`;
  variants.set(m, variant);
  const owned = variant;
  m.addEventListener('dispose', () => owned.dispose());
  return variant;
}

// Retain template identity so repeated static parts still use InstancedMesh, not unique draws.
export const thermalSources = new WeakMap<THREE.BufferGeometry, { source: THREE.BufferGeometry; slot: number }>();
export function thermalGeometry(source: THREE.BufferGeometry, slot: number): THREE.BufferGeometry {
  const g = source.clone();
  g.setAttribute('wspHeatSlot', new THREE.Float32BufferAttribute(new Float32Array(source.getAttribute('position').count).fill(slot), 1));
  thermalSources.set(g, { source, slot });
  return g;
}
