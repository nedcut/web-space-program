import * as THREE from 'three';
import { biomeIndexAt, hasBiomeMap, type BiomeMap } from '../../sim/science/biomeMap';
import { biomeAt } from '../../sim/science/biomes';
import { createTerrain } from '../../sim/terrain';
import type { Terrain } from '../../sim/terrain/api';
import { EARTH_CITIES } from '../../data/earthCities';
import type { Body } from '../../sim/bodies/types';
import type { Quat } from '../../util/quat';
import type { Vec3 } from '../../util/vec3';
import { biomeStyle, BIOME_TARGET_CSS } from './biomeStyle';
import { LABEL_SHADOW } from './markerGlyphs';
import { placeLabel, type LabelBox } from './presentation';
import { setPosition, setStyle } from './styleWriter';

/** A biome an active objective asks for: highlighted and labelled whether or not the biome overlay is on. */
export interface BiomeTarget { body: string; biome: string; label: string }

export interface LegendEntry { name: string; color: string; target: boolean }

export interface SurfaceFrame {
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  /** CSS px per world metre at unit distance from the camera. */
  pxPerWorld1: number;
  /** Accepted label boxes (body labels, markers) and how many are in use; surface labels append to it. */
  boxes: LabelBox[];
  count: number;
}

const MAX_BIOMES = 24;
/** Overlay shell above the far sphere: clears a 96-segment sphere's facets and the overlay's own (128 segments). */
const SHELL = 1.003;
const REGION_POOL = 40, CITY_POOL = 90;

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;

/**
 * Biome cells (R8 indices, row 0 north) looked up per fragment from the body-fixed direction, so there is no UV
 * seam. Each fragment takes the biome with the largest bilinear weight among its four nearest cells, so close up
 * the boundaries run as smooth contours instead of cell stair-steps; outlines come from screen-space derivatives
 * of the result (one or two pixels wide at every zoom, no extra fetches).
 */
const FRAGMENT = /* glsl */ `
  uniform sampler2D uCells;
  uniform vec2 uSize;
  uniform vec4 uPalette[${MAX_BIOMES}];
  uniform float uMask[${MAX_BIOMES}];
  uniform float uAll;
  uniform float uPulse;
  varying vec3 vDir;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  int cellAt(vec2 c) {
    int x = int(mod(c.x, uSize.x));
    int y = int(clamp(c.y, 0.0, uSize.y - 1.0));
    return int(texelFetch(uCells, ivec2(x, y), 0).r * 255.0 + 0.5);
  }
  int biomeAt(vec2 c) {
    vec2 b = floor(c - 0.5), f = c - 0.5 - b;
    int a00 = cellAt(b), a10 = cellAt(b + vec2(1.0, 0.0)), a01 = cellAt(b + vec2(0.0, 1.0)), a11 = cellAt(b + 1.0);
    float w00 = (1.0 - f.x) * (1.0 - f.y), w10 = f.x * (1.0 - f.y), w01 = (1.0 - f.x) * f.y, w11 = f.x * f.y;
    float s00 = w00 + (a10 == a00 ? w10 : 0.0) + (a01 == a00 ? w01 : 0.0) + (a11 == a00 ? w11 : 0.0);
    float s10 = w10 + (a01 == a10 ? w01 : 0.0) + (a11 == a10 ? w11 : 0.0);
    float s01 = w01 + (a11 == a01 ? w11 : 0.0);
    int id = a00; float best = s00;
    if (s10 > best) { best = s10; id = a10; }
    if (s01 > best) { best = s01; id = a01; }
    if (w11 > best) id = a11;
    return id;
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vDir);
    float lon = atan(d.y, d.x), lat = asin(clamp(d.z, -1.0, 1.0));
    vec2 c = vec2((lon / 6.2831853 + 0.5) * uSize.x, (0.5 - lat / 3.14159265) * uSize.y);
    int id = biomeAt(c);
    bool edge = fwidth(float(id)) > 0.0;
    vec4 base = uPalette[id];
    vec3 color = base.rgb;
    float alpha = uAll * min(1.0, base.a * (edge ? 1.8 : 1.0));
    if (uMask[id] > 0.5) {
      color = edge ? vec3(1.0, 0.8, 0.3) : mix(base.rgb, vec3(1.0, 0.8, 0.3), 0.35);
      alpha = edge ? 0.95 : max(alpha, 0.3 + 0.2 * uPulse);
    }
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }`;

interface BodyLayer {
  body: Body;
  map: BiomeMap | null;
  requested: boolean;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  /** Scene-space centre and body-fixed → scene rotation, as placed this frame. */
  center: THREE.Vector3;
  rotation: THREE.Quaternion;
  placed: boolean;
  /** Created on the first hover: the exact classifier needs the body's terrain. */
  terrain: Terrain | null;
}

interface LabelEl { el: HTMLDivElement; textEl: HTMLElement; text: string; color: string; box: LabelBox }

function makeMaterial(texture: THREE.Texture, width: number, height: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, toneMapped: false,
    uniforms: {
      uCells: { value: texture }, uSize: { value: new THREE.Vector2(width, height) },
      uPalette: { value: Array.from({ length: MAX_BIOMES }, () => new THREE.Vector4()) },
      uMask: { value: new Array<number>(MAX_BIOMES).fill(0) },
      uAll: { value: 0 }, uPulse: { value: 0 },
    },
  });
}

function cellTexture(cells: Uint8Array, width: number, height: number): THREE.DataTexture {
  const t = new THREE.DataTexture(cells, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const scratchColor = new THREE.Color();

/**
 * Map-view surface information: the biome overlay (any body with more than one biome), objective highlights and
 * labels, and Earth's city labels. Biome maps are requested from the host's source the first time a body needs
 * one. Per frame it only places meshes and writes pooled DOM labels.
 */
export class SurfaceLayers {
  biomes = false;
  cities = true;
  readonly warmObject: THREE.Mesh;
  private source: ((body: Body) => Promise<BiomeMap | null>) | null = null;
  private readonly layers = new Map<string, BodyLayer>();
  private readonly geometry: THREE.SphereGeometry;
  private targets: BiomeTarget[] = [];
  private readonly targetBodies = new Set<string>();
  private readonly regionEls: LabelEl[] = [];
  private readonly cityEls: LabelEl[] = [];
  private readonly cityDirs: Float64Array;
  /** Screen positions of the city dots drawn this frame (hover). */
  private readonly cityScreen = new Float32Array(CITY_POOL * 2);
  private readonly cityShown = new Int32Array(CITY_POOL);
  private cityCount = 0;
  /** Accepted-label count while `update` runs. */
  private count = 0;
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly ray = new THREE.Ray();
  private readonly ndc = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly inverse = new THREE.Quaternion();
  /** Bumped when a biome map arrives or targets change, so hosts can refresh legends. */
  version = 0;
  onChange: (() => void) | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly host: HTMLElement, bodies: Map<string, Body>) {
    this.geometry = new THREE.SphereGeometry(1, 128, 64);
    this.geometry.rotateX(Math.PI / 2); // poles on ±Z, the body-fixed frame
    const warm = new Uint8Array(4);
    this.warmObject = new THREE.Mesh(this.geometry, makeMaterial(cellTexture(warm, 2, 2), 2, 2));
    this.warmObject.visible = false; this.warmObject.frustumCulled = false;
    scene.add(this.warmObject);
    for (const body of bodies.values()) if (hasBiomeMap(body) || body.id === 'earth') {
      this.layers.set(body.id, { body, map: null, requested: false, mesh: null, center: new THREE.Vector3(), rotation: new THREE.Quaternion(), placed: false, terrain: null });
    }
    this.cityDirs = new Float64Array(EARTH_CITIES.length * 3);
    EARTH_CITIES.forEach(([, lat, lon], i) => {
      const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
      this.cityDirs[i * 3] = Math.cos(la) * Math.cos(lo); this.cityDirs[i * 3 + 1] = Math.cos(la) * Math.sin(lo); this.cityDirs[i * 3 + 2] = Math.sin(la);
    });
  }

  setSource(source: ((body: Body) => Promise<BiomeMap | null>) | null) { this.source = source; }

  setBiomes(on: boolean) { this.biomes = on; this.version++; }

  setCities(on: boolean) { this.cities = on; }

  setTargets(targets: readonly BiomeTarget[]) {
    const same = targets.length === this.targets.length && targets.every((t, i) => t.body === this.targets[i].body && t.biome === this.targets[i].biome && t.label === this.targets[i].label);
    if (same) return;
    this.targets = targets.map(t => ({ ...t }));
    this.targetBodies.clear();
    for (const t of targets) this.targetBodies.add(t.body);
    for (const layer of this.layers.values()) if (layer.mesh && layer.map) this.writeMask(layer);
    this.version++;
  }

  /** Whether a body gets a biome map (more than one biome). */
  mapsBody(bodyId: string): boolean {
    const layer = this.layers.get(bodyId);
    return !!layer && hasBiomeMap(layer.body);
  }

  /** Biome map for a body if it has arrived (requests it otherwise). */
  biomeMap(bodyId: string): BiomeMap | null {
    const layer = this.layers.get(bodyId);
    if (!layer) return null;
    this.request(layer);
    return layer.map;
  }

  /** Legend rows for a body: biomes present on its map, objectives first. Null while the map is not ready. */
  legend(bodyId: string): LegendEntry[] | null {
    const map = this.biomeMap(bodyId);
    if (!map) return null;
    const present = new Set(map.regions.map(r => r.biome));
    const rows = map.names.filter((_, i) => present.has(i)).map(name => ({ name, color: biomeStyle(name).color, target: this.isTarget(bodyId, name) }));
    return rows.sort((a, b) => Number(b.target) - Number(a.target));
  }

  /**
   * Body-fixed label anchor of a biome: its region nearest to `near` (body-fixed unit vector) among regions at
   * least a quarter the size of its largest, else its largest. Null when the map is not ready or lacks the biome.
   */
  anchor(bodyId: string, biome: string, near?: Vec3): Vec3 | null {
    const map = this.biomeMap(bodyId);
    const index = map?.names.indexOf(biome) ?? -1;
    if (!map || index < 0) return null;
    let largest = 0;
    for (const r of map.regions) if (r.biome === index) largest = Math.max(largest, r.area);
    let best: Vec3 | null = null, score = -Infinity;
    for (const r of map.regions) {
      if (r.biome !== index || r.area < largest * 0.25) continue;
      const s = near ? r.anchor.x * near.x + r.anchor.y * near.y + r.anchor.z * near.z : r.area;
      if (s > score) { score = s; best = r.anchor; }
    }
    return best;
  }

  private isTarget(bodyId: string, biome: string) {
    for (const t of this.targets) if (t.body === bodyId && t.biome === biome) return true;
    return false;
  }

  private request(layer: BodyLayer) {
    if (layer.requested || !this.source || !hasBiomeMap(layer.body)) return;
    layer.requested = true;
    void this.source(layer.body).then(map => {
      if (!map || layer.map) return;
      layer.map = map;
      this.createMesh(layer, map);
      this.version++;
      this.onChange?.();
    }, () => {});
  }

  private createMesh(layer: BodyLayer, map: BiomeMap) {
    const material = makeMaterial(cellTexture(map.cells, map.width, map.height), map.width, map.height);
    const palette = material.uniforms.uPalette.value as THREE.Vector4[];
    map.names.slice(0, MAX_BIOMES).forEach((name, i) => {
      const style = biomeStyle(name);
      scratchColor.set(style.color);
      palette[i].set(scratchColor.r, scratchColor.g, scratchColor.b, style.alpha);
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.scale.setScalar(layer.body.radius * SHELL);
    // After the planet and its atmosphere shell, so the overlay reads on top of the haze; before orbit lines.
    mesh.renderOrder = 2;
    mesh.frustumCulled = false; mesh.visible = false; mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    layer.mesh = mesh;
    this.writeMask(layer);
  }

  private writeMask(layer: BodyLayer) {
    const mask = layer.mesh!.material.uniforms.uMask.value as number[];
    const names = layer.map!.names;
    for (let i = 0; i < MAX_BIOMES; i++) mask[i] = i < names.length && this.isTarget(layer.body.id, names[i]) ? 1 : 0;
  }

  /** Called for every body each frame with its scene placement; `rotation` is undefined when it is not drawn. */
  placeBody(id: string, center: THREE.Vector3, rotation: Quat | undefined) {
    const layer = this.layers.get(id);
    if (!layer) return;
    layer.placed = !!rotation;
    const wanted = !!rotation && (this.biomes || this.targetBodies.has(id));
    if (wanted) this.request(layer);
    const mesh = layer.mesh;
    if (!rotation) { if (mesh) mesh.visible = false; return; }
    layer.center.copy(center);
    layer.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    if (!mesh) return;
    mesh.visible = wanted;
    if (!wanted) return;
    mesh.position.copy(center); mesh.quaternion.copy(layer.rotation); mesh.updateMatrix();
    const u = mesh.material.uniforms;
    u.uAll.value = this.biomes ? 1 : 0;
    u.uPulse.value = 0.5 + 0.5 * Math.sin(performance.now() / 320);
  }

  private label(pool: LabelEl[], i: number, city: boolean): LabelEl {
    let item = pool[i];
    if (!item) {
      const el = document.createElement('div');
      let textEl: HTMLElement = el;
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap', textShadow: LABEL_SHADOW, pointerEvents: 'none',
        font: city ? '500 11px system-ui, sans-serif' : '650 10.5px system-ui, sans-serif', letterSpacing: city ? '.01em' : '.08em',
        textTransform: city ? 'none' : 'uppercase', display: 'none' });
      if (city) {
        const dot = document.createElement('span');
        Object.assign(dot.style, { display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: '#ffe9b8', boxShadow: '0 0 0 1.5px #02050ccc', marginRight: '5px', verticalAlign: '1px' });
        el.appendChild(dot);
        textEl = document.createElement('span');
        el.appendChild(textEl);
      }
      this.host.appendChild(el);
      item = pool[i] = { el, textEl, text: '', color: '', box: { x: 0, y: 0, width: 0, height: 16 } };
    }
    return item;
  }

  private setText(item: LabelEl, text: string, city: boolean) {
    if (item.text === text) return;
    item.text = text;
    item.textEl.textContent = text;
    item.box.width = text.length * (city ? 6.2 : 7.4) + (city ? 18 : 10);
  }

  /**
   * Region and city labels for this frame, after body labels and markers (which keep priority). Returns the new
   * accepted-label count.
   */
  update(f: SurfaceFrame): number {
    let regions = 0, cities = 0;
    this.count = f.count;
    for (const layer of this.layers.values()) {
      if (!layer.placed) continue;
      const map = layer.map, R = layer.body.radius;
      const showAll = this.biomes, targeted = this.targetBodies.has(layer.body.id);
      if (map && (showAll || targeted)) {
        // Objective regions first, then the largest regions.
        for (let pass = 0; pass < 2; pass++) for (const r of map.regions) {
          if (regions >= REGION_POOL) break;
          const name = map.names[r.biome], target = this.isTarget(layer.body.id, name);
          if (pass === 0 ? !target : target || !showAll) continue;
          const screen = this.project(layer, r.anchor.x, r.anchor.y, r.anchor.z, R, f);
          if (!screen) continue;
          // Large enough on screen to hold a label (objectives are always named).
          const radiusPx = R * Math.sqrt(r.area / Math.PI) / screen * f.pxPerWorld1;
          const item = this.label(this.regionEls, regions, false);
          const text = target ? this.targetLabel(layer.body.id, name) : name;
          this.setText(item, text, false);
          if (!target && radiusPx < item.box.width * 0.6) continue;
          const box = item.box;
          box.x = this.v.x - box.width / 2; box.y = this.v.y - 8;
          if (!placeLabel(box, f.boxes, this.count)) continue;
          f.boxes[this.count++] = box;
          const color = target ? BIOME_TARGET_CSS : biomeStyle(name).color;
          if (item.color !== color) { item.color = color; setStyle(item.el, 'color', color); }
          setPosition(item.el, box.x, box.y + 8, ' translateY(-50%)');
          setStyle(item.el, 'display', 'block');
          regions++;
        }
      }
      if (layer.body.id === 'earth' && this.cities) cities = this.updateCities(layer, R, f);
    }
    for (let i = regions; i < this.regionEls.length; i++) setStyle(this.regionEls[i].el, 'display', 'none');
    for (let i = cities; i < this.cityEls.length; i++) setStyle(this.cityEls[i].el, 'display', 'none');
    this.cityCount = cities;
    return this.count;
  }

  private targetLabel(bodyId: string, biome: string): string {
    for (const t of this.targets) if (t.body === bodyId && t.biome === biome) return t.label;
    return biome;
  }

  /**
   * Screen position of a body-fixed direction on the surface into `this.v` (CSS px). Returns the camera distance,
   * or 0 when the point is behind the limb or off screen.
   */
  private project(layer: BodyLayer, dx: number, dy: number, dz: number, R: number, f: SurfaceFrame): number {
    const n = this.w.set(dx, dy, dz).applyQuaternion(layer.rotation);
    const p = this.v.copy(n).multiplyScalar(R).add(layer.center);
    const cam = f.camera.position;
    const tx = cam.x - p.x, ty = cam.y - p.y, tz = cam.z - p.z, dist = Math.hypot(tx, ty, tz);
    // Facing the camera, a little inside the limb.
    if ((n.x * tx + n.y * ty + n.z * tz) / dist < 0.08) return 0;
    p.project(f.camera);
    if (!(p.z > -1 && p.z < 1)) return 0;
    p.x = (p.x * 0.5 + 0.5) * f.width; p.y = (-p.y * 0.5 + 0.5) * f.height;
    if (p.x < -40 || p.y < -20 || p.x > f.width + 40 || p.y > f.height + 20) return 0;
    return dist;
  }

  private updateCities(layer: BodyLayer, R: number, f: SurfaceFrame): number {
    let shown = 0;
    // The whole globe must be large on screen before any city shows; nearer surface, smaller places appear.
    const discPx = R / Math.max(1, layer.center.distanceTo(f.camera.position)) * f.pxPerWorld1;
    if (discPx < 260) return 0;
    for (let i = 0; i < EARTH_CITIES.length && shown < CITY_POOL; i++) {
      const dist = this.project(layer, this.cityDirs[i * 3], this.cityDirs[i * 3 + 1], this.cityDirs[i * 3 + 2], R, f);
      if (!dist) continue;
      const localPx = R / dist * f.pxPerWorld1;
      if (localPx < 300 * Math.sqrt(1 + i / 4)) continue;
      const item = this.label(this.cityEls, shown, true);
      this.setText(item, EARTH_CITIES[i][0], true);
      const box = item.box;
      box.x = this.v.x - 4; box.y = this.v.y - 8;
      if (!placeLabel(box, f.boxes, this.count)) continue;
      f.boxes[this.count++] = box;
      setPosition(item.el, box.x, box.y + 8, ' translateY(-50%)');
      const color = EARTH_CITIES[i][4] ? '#fff3d6' : '#e6dcc4';
      if (item.color !== color) { item.color = color; setStyle(item.el, 'color', color); }
      setStyle(item.el, 'display', 'block');
      this.cityScreen[shown * 2] = this.v.x; this.cityScreen[shown * 2 + 1] = this.v.y;
      this.cityShown[shown] = i;
      shown++;
    }
    return shown;
  }

  /** Hover text for a CSS-pixel position: a city dot within a few pixels, else the biome under the cursor. */
  describe(x: number, y: number, f: { camera: THREE.Camera; width: number; height: number }): string | null {
    for (let i = 0; i < this.cityCount; i++) {
      if (Math.hypot(this.cityScreen[i * 2] - x, this.cityScreen[i * 2 + 1] - y) < 7) {
        const [name, , , population, capital] = EARTH_CITIES[this.cityShown[i]];
        return `${name}${capital ? ' · capital' : ''}\nPopulation ≈ ${population >= 1e6 ? `${(population / 1e6).toFixed(1)} million` : `${Math.round(population / 1e3)} thousand`}`;
      }
    }
    this.ndc.set(x / f.width * 2 - 1, 1 - y / f.height * 2);
    this.raycaster.setFromCamera(this.ndc, f.camera);
    const ray = this.ray.copy(this.raycaster.ray);
    let best = Infinity, hit: BodyLayer | null = null;
    for (const layer of this.layers.values()) {
      if (!layer.placed || !layer.map || !(this.biomes || this.targetBodies.has(layer.body.id))) continue;
      const toCentre = this.w.copy(layer.center).sub(ray.origin);
      const along = toCentre.dot(ray.direction), miss = toCentre.lengthSq() - along * along, R = layer.body.radius;
      if (miss > R * R) continue;
      const t = along - Math.sqrt(R * R - miss);
      if (t > 0 && t < best) { best = t; hit = layer; }
    }
    if (!hit) return null;
    const p = ray.at(best, this.v).sub(hit.center).applyQuaternion(this.inverse.copy(hit.rotation).invert());
    // The exact biome under the cursor (what an experiment there records); smoothed colours show the area's main one.
    let name = hit.map!.names[biomeIndexAt(hit.map!, p)];
    try { name = biomeAt(hit.body, hit.terrain ??= createTerrain(hit.body), p); } catch { /* keep the map's cell */ }
    return this.isTarget(hit.body.id, name) ? `${name} · ${hit.body.name}\n${this.targetLabel(hit.body.id, name)}` : `${name} · ${hit.body.name}`;
  }

  dispose() {
    for (const layer of this.layers.values()) if (layer.mesh) {
      layer.mesh.removeFromParent();
      (layer.mesh.material.uniforms.uCells.value as THREE.Texture).dispose();
      layer.mesh.material.dispose();
    }
    (this.warmObject.material as THREE.ShaderMaterial).uniforms.uCells.value.dispose();
    for (const item of [...this.regionEls, ...this.cityEls]) item.el.remove();
    this.geometry.dispose();
  }
}
