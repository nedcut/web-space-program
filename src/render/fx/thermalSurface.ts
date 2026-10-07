import * as THREE from 'three';

// Two radiance slots per part: skin and nozzle. Slot zero is always cold.
// Direct dynamic attributes avoid a vertex-texture fetch on every part draw.
const CAPACITY = 8192;
export const thermalRadiance = new Float32Array(CAPACITY * 3);
interface Span { attribute: THREE.BufferAttribute; start: number; end: number }
const spans = new Map<number, Set<Span>>();
const free: number[] = [];
let next = 2;
export function allocateThermalSlot(): number {
  if (free.length) return free.pop()!;
  if (next >= CAPACITY) return 0; // Bounded visual budget; simulation is unaffected.
  const slot = next; next += 2; return slot;
}
export function writeThermalSlot(slot: number, color: THREE.Color): void {
  if (!slot) return;
  const i = slot * 3;
  const r = Math.fround(color.r), g = Math.fround(color.g), b = Math.fround(color.b);
  if (thermalRadiance[i] === r && thermalRadiance[i + 1] === g && thermalRadiance[i + 2] === b) return;
  thermalRadiance[i] = r; thermalRadiance[i + 1] = g; thermalRadiance[i + 2] = b;
  for (const span of spans.get(slot) ?? []) {
    const array = span.attribute.array;
    for (let j = span.start; j < span.end; j += 3) { array[j] = r; array[j + 1] = g; array[j + 2] = b; }
    span.attribute.needsUpdate = true;
  }
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
    shader.vertexShader = 'attribute vec3 wspHeatRadiance;\nvarying vec3 wspRadiance;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n wspRadiance = wspHeatRadiance;');
    shader.fragmentShader = 'varying vec3 wspRadiance;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += wspRadiance;');
  };
  variant.customProgramCacheKey = () => `${m.customProgramCacheKey()}:thermal-v2`;
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
  bindThermalRadiance(g);
  thermalSources.set(g, { source, slot });
  return g;
}

/** Register the final merged/instanced geometry, whose attributes no longer alias its inputs. */
export function bindThermalRadiance(geometry: THREE.BufferGeometry): void {
  const slots = geometry.getAttribute('wspHeatSlot');
  if (!slots) return;
  const array = new Float32Array(slots.count * 3);
  const attribute = slots instanceof THREE.InstancedBufferAttribute
    ? new THREE.InstancedBufferAttribute(array, 3)
    : new THREE.BufferAttribute(array, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('wspHeatRadiance', attribute);
  const owned: { slot: number; span: Span }[] = [];
  for (let start = 0; start < slots.count;) {
    const slot = slots.getX(start);
    let end = start + 1;
    while (end < slots.count && slots.getX(end) === slot) end++;
    const span = { attribute, start: start * 3, end: end * 3 };
    const at = slot * 3;
    for (let i = span.start; i < span.end; i += 3) {
      array[i] = thermalRadiance[at]; array[i + 1] = thermalRadiance[at + 1]; array[i + 2] = thermalRadiance[at + 2];
    }
    let list = spans.get(slot);
    if (!list) spans.set(slot, list = new Set());
    list.add(span); owned.push({ slot, span });
    start = end;
  }
  const dispose = () => {
    for (const { slot, span } of owned) {
      const list = spans.get(slot); list?.delete(span);
      if (!list?.size) spans.delete(slot);
    }
    geometry.removeEventListener('dispose', dispose);
  };
  geometry.addEventListener('dispose', dispose);
}
