import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural vehicle-assembly hall. Everything is generated: canvas textures for the polished epoxy floor (colour +
 * roughness, with baked contact AO), tidy wall cladding, merged box geometry for the steel frame and emissive strips
 * that read as the light sources. Palette follows the UI: navy/slate surfaces, cyan accents, warm-white lamps.
 * A couple of dozen draw calls total, no extra render passes.
 */

export const HANGAR = { halfX: 36, halfZ: 34, height: 56 } as const;

/** Assembly platform (turntable) radius and height. */
const PLATFORM_R = 6.5;
const PLATFORM_H = 0.18;

export interface Hangar {
  group: THREE.Group;
  /** Size the soft contact shadow under the craft (world metres, centred on the platform). `lift`: craft bottom height. */
  setFootprint(rx: number, rz: number, lift: number): void;
  /**
   * Bake the lit hall (without the floor) into a box-projected reflection probe used by the polished floor and
   * platform. Call once after the scene's lights are set up and before the craft is added. One PMREM bake, no
   * per-frame cost beyond a few ALU ops in the floor shader.
   */
  bakeReflections(scene: THREE.Scene): void;
  dispose(): void;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

/** Deterministic PRNG so the hall looks the same every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const FLOOR_W = HANGAR.halfX * 2;

/** Painted markings shared by the colour and roughness maps (paint is a touch rougher than the epoxy). */
function paintMarkings(g: CanvasRenderingContext2D, S: number, paint: (c: string) => string) {
  const px = S / FLOOR_W;
  const cx = S / 2, cy = S / 2;
  const pad = 9 * px;
  // Hazard ring around the assembly pad.
  const inner = pad, outer = pad + 0.4 * px;
  const n = 96;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2;
    g.fillStyle = paint('#d9a930');
    g.beginPath();
    g.arc(cx, cy, outer, a0, a1);
    g.arc(cx, cy, inner, a1, a0, true);
    g.closePath(); g.fill();
  }
  // Cyan guide rings and radial ticks.
  g.strokeStyle = paint('rgba(92,200,255,0.75)');
  g.lineWidth = 0.08 * px;
  g.beginPath(); g.arc(cx, cy, pad - 0.45 * px, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = paint('rgba(220,232,245,0.55)');
  g.lineWidth = 0.06 * px;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const l0 = pad - (i % 9 === 0 ? 1.6 : i % 3 === 0 ? 1.1 : 0.85) * px, l1 = pad - 0.6 * px;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * l0, cy + Math.sin(a) * l0); g.lineTo(cx + Math.cos(a) * l1, cy + Math.sin(a) * l1); g.stroke();
  }
  // Dashed amber lanes toward the doors (-Z = top of the texture) and white walkway borders.
  g.fillStyle = paint('rgba(217,169,48,0.9)');
  const lane = 15 * px;
  for (const sx of [-1, 1]) {
    for (let y = 1.5 * px; y < cy - outer - 1 * px; y += 1.6 * px) g.fillRect(cx + sx * lane - 0.1 * px, y, 0.2 * px, 0.9 * px);
  }
  g.fillStyle = paint('rgba(225,233,243,0.6)');
  for (const sx of [-1, 1]) g.fillRect(cx + sx * (FLOOR_W / 2 - 6) * px - 0.08 * px, 0, 0.16 * px, S);
  // Stencilled bay marker in front of the pad.
  g.save();
  g.translate(cx, cy + pad + 3.2 * px);
  g.fillStyle = paint('rgba(225,233,243,0.5)');
  g.font = `700 ${Math.round(1.3 * px)}px Inter, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ASSEMBLY BAY 1', 0, 0);
  g.fillStyle = paint('rgba(92,200,255,0.7)');
  g.fillRect(-3 * px, 1.05 * px, 6 * px, 0.14 * px);
  g.restore();
}

function floorTexture(maxAniso: number): THREE.Texture {
  const S = 2048;
  const { c, g } = canvas(S, S);
  const r = rng(7);
  const px = S / FLOOR_W;
  // Base: dark slate epoxy with soft cloudy mottling and fine aggregate speckle.
  g.fillStyle = '#252d37';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) {
    const x = r() * S, y = r() * S, rad = 20 + r() * 90;
    const l = r() < 0.5 ? 58 : 92;
    g.fillStyle = `rgba(${l},${l + 4},${l + 10},${0.03 + r() * 0.04})`;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 14000; i++) {
    const l = r() < 0.5 ? 46 : 130;
    g.fillStyle = `rgba(${l},${l + 2},${l + 6},${0.06 + r() * 0.08})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  // Slab joints every 6 m (cut lines).
  g.strokeStyle = 'rgba(18,22,28,0.4)';
  g.lineWidth = 1.5;
  for (let m = 0; m <= FLOOR_W; m += 6) {
    g.beginPath(); g.moveTo(m * px, 0); g.lineTo(m * px, S); g.stroke();
    g.beginPath(); g.moveTo(0, m * px); g.lineTo(S, m * px); g.stroke();
  }
  // Ambient occlusion toward the walls.
  const edge = 3 * px;
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
    [0, 0, edge, 0, 0, 0, edge, S], [S, 0, S - edge, 0, S - edge, 0, edge, S],
    [0, 0, 0, edge, 0, 0, S, edge], [0, S, 0, S - edge, 0, S - edge, S, edge],
  ] as const) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(10,12,16,0.55)');
    gr.addColorStop(1, 'rgba(10,12,16,0)');
    g.fillStyle = gr;
    g.fillRect(rx, ry, rw, rh);
  }
  const cx = S / 2, cy = S / 2;
  // Central assembly pad: darker, finer-finish disc.
  const pad = 9 * px;
  const grad = g.createRadialGradient(cx, cy, pad * 0.3, cx, cy, pad);
  grad.addColorStop(0, '#2f353e');
  grad.addColorStop(1, '#363d47');
  g.fillStyle = grad;
  g.beginPath(); g.arc(cx, cy, pad, 0, Math.PI * 2); g.fill();
  // Baked AO ring around the platform foot.
  const ao = g.createRadialGradient(cx, cy, PLATFORM_R * px, cx, cy, (PLATFORM_R + 1.4) * px);
  ao.addColorStop(0, 'rgba(6,8,12,0.6)');
  ao.addColorStop(1, 'rgba(6,8,12,0)');
  g.fillStyle = ao;
  g.beginPath(); g.arc(cx, cy, (PLATFORM_R + 1.4) * px, 0, Math.PI * 2); g.fill();
  paintMarkings(g, S, (col) => col);
  // Faint tyre / scuff marks.
  for (let i = 0; i < 24; i++) {
    g.strokeStyle = `rgba(16,18,22,${0.04 + r() * 0.05})`;
    g.lineWidth = 3 + r() * 6;
    g.beginPath();
    const x = r() * S, y = r() * S;
    g.moveTo(x, y);
    g.quadraticCurveTo(x + (r() - 0.5) * 300, y + (r() - 0.5) * 300, x + (r() - 0.5) * 500, y + (r() - 0.5) * 500);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

/** Roughness (green channel): polished epoxy ~0.28 with buffing swirls, rougher paint, scuffs and joints. */
function floorRoughness(maxAniso: number): THREE.Texture {
  const S = 1024;
  const { c, g } = canvas(S, S);
  const r = rng(19);
  const v = (x: number) => Math.round(THREE.MathUtils.clamp(x, 0, 1) * 255);
  const grey = (x: number, a = 1) => `rgba(${v(x)},${v(x)},${v(x)},${a})`;
  g.fillStyle = grey(0.5);
  g.fillRect(0, 0, S, S);
  // Low-frequency patches (some areas more worn).
  for (let i = 0; i < 700; i++) {
    g.fillStyle = grey(r() < 0.6 ? 0.42 : 0.14, 0.04 + r() * 0.06);
    g.beginPath(); g.ellipse(r() * S, r() * S, 10 + r() * 50, 6 + r() * 30, r() * Math.PI, 0, Math.PI * 2); g.fill();
  }
  // Soften the patches into a cloudy wear pattern.
  g.filter = 'blur(10px)';
  g.drawImage(c, 0, 0);
  g.filter = 'none';
  // Circular buffing swirls.
  g.lineWidth = 2;
  for (let i = 0; i < 320; i++) {
    g.strokeStyle = grey(r() < 0.5 ? 0.45 : 0.18, 0.12);
    const rad = 8 + r() * 26;
    g.beginPath(); g.arc(r() * S, r() * S, rad, r() * 6, r() * 6 + 2 + r() * 3); g.stroke();
  }
  const px = S / FLOOR_W;
  g.strokeStyle = grey(0.5);
  g.lineWidth = 1;
  for (let m = 0; m <= FLOOR_W; m += 6) {
    g.beginPath(); g.moveTo(m * px, 0); g.lineTo(m * px, S); g.stroke();
    g.beginPath(); g.moveTo(0, m * px); g.lineTo(S, m * px); g.stroke();
  }
  // The assembly pad is freshly polished.
  g.fillStyle = grey(0.48, 0.8);
  g.beginPath(); g.arc(S / 2, S / 2, 9 * px, 0, Math.PI * 2); g.fill();
  paintMarkings(g, S, () => grey(0.6));
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = maxAniso;
  return t;
}

/** One 4 m x 4 m tile of tidy composite wall panels: two 2 m panels, bevelled seams, fastener rows. */
function claddingTexture(maxAniso: number): THREE.Texture {
  const S = 512;
  const { c, g } = canvas(S, S);
  const r = rng(3);
  g.fillStyle = '#3d4858';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2; i++) {
    const x = i * 256;
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, i ? '#435064' : '#46536a');
    grd.addColorStop(1, i ? '#3a4556' : '#3c4859');
    g.fillStyle = grd;
    g.fillRect(x + 4, 4, 248, S - 8);
    // Fine brushed streaks.
    for (let k = 0; k < 60; k++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.025})`;
      g.fillRect(x + 6 + r() * 244, 6, 1, S - 12);
    }
    // Bevel: light top/left, dark bottom/right.
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x + 4, 4, 248, 2);
    g.fillRect(x + 4, 4, 2, S - 8);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x + 4, S - 6, 248, 2);
    g.fillRect(x + 250, 4, 2, S - 8);
    // Fastener rows.
    g.fillStyle = 'rgba(20,24,30,0.55)';
    for (let y = 24; y < S; y += 61) { g.fillRect(x + 12, y, 3, 3); g.fillRect(x + 241, y, 3, 3); }
  }
  // Seams.
  g.fillStyle = '#1b2029';
  g.fillRect(0, 0, S, 4);
  g.fillRect(0, S - 4, S, 4);
  g.fillRect(0, 0, 4, S);
  g.fillRect(252, 0, 8, S);
  g.fillRect(S - 4, 0, 4, S);
  // Light weathering.
  for (let i = 0; i < 80; i++) {
    g.fillStyle = `rgba(20,24,30,${r() * 0.05})`;
    g.fillRect(r() * S, r() * S, 2 + r() * 10, 20 + r() * 80);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

function doorTexture(): THREE.Texture {
  const { c, g } = canvas(512, 1024);
  g.fillStyle = '#5d6878';
  g.fillRect(0, 0, 512, 1024);
  // Horizontal ribbing
  for (let y = 0; y < 1024; y += 16) {
    g.fillStyle = y % 32 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)';
    g.fillRect(0, y, 512, 8);
  }
  // Panel frames
  g.strokeStyle = 'rgba(24,28,36,0.85)';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 504, 1016);
  for (let y = 128; y < 1024; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  // Cyan position stripe and hazard band at the bottom
  g.fillStyle = 'rgba(92,200,255,0.55)';
  g.fillRect(0, 500, 512, 6);
  for (let x = -64; x < 512; x += 48) {
    g.fillStyle = '#d9a930';
    g.beginPath(); g.moveTo(x, 1024); g.lineTo(x + 24, 1024); g.lineTo(x + 64, 976); g.lineTo(x + 40, 976); g.closePath(); g.fill();
  }
  g.fillStyle = 'rgba(20,20,22,0.85)';
  g.fillRect(0, 970, 512, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(text: string, sub: string): THREE.Texture {
  const { c, g } = canvas(2048, 512);
  g.clearRect(0, 0, 2048, 512);
  g.fillStyle = 'rgba(232,238,246,0.92)';
  g.font = '800 250px Inter, system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text, 30, 210);
  g.fillStyle = '#5cc8ff';
  g.fillRect(36, 370, 260, 18);
  g.fillStyle = 'rgba(232,238,246,0.7)';
  g.font = '600 80px Inter, system-ui, sans-serif';
  g.fillText(sub, 330, 380);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Turntable deck: brushed concentric rings, segment seams and fasteners (top-cap UVs are planar). */
function platformTexture(maxAniso: number): THREE.Texture {
  const S = 1024;
  const { c, g } = canvas(S, S);
  const r = rng(23);
  const cx = S / 2, R = S / 2;
  g.fillStyle = '#4a5462';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const rad = r() * R;
    const l = 60 + r() * 50;
    g.strokeStyle = `rgba(${l},${l + 8},${l + 18},${0.08 + r() * 0.12})`;
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cx, rad, 0, Math.PI * 2); g.stroke();
  }
  // Inner disc (darker), outer bevel band.
  g.fillStyle = 'rgba(16,20,26,0.35)';
  g.beginPath(); g.arc(cx, cx, R * 0.45, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(12,15,20,0.7)';
  g.lineWidth = 3;
  for (const f of [0.45, 0.93]) { g.beginPath(); g.arc(cx, cx, R * f, 0, Math.PI * 2); g.stroke(); }
  // Segment seams between the rings.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.45, cx + Math.sin(a) * R * 0.45); g.lineTo(cx + Math.cos(a) * R * 0.93, cx + Math.sin(a) * R * 0.93); g.stroke();
  }
  g.fillStyle = 'rgba(200,210,224,0.35)';
  for (let i = 0; i < 48; i++) {
    const a = ((i + 0.5) / 48) * Math.PI * 2;
    g.beginPath(); g.arc(cx + Math.cos(a) * R * 0.965, cx + Math.sin(a) * R * 0.965, 2.5, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

/** Soft radial falloff (white centre, transparent edge) for the contact shadow. */
function blobTexture(): THREE.Texture {
  const S = 128;
  const { c, g } = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    gr.addColorStop(t, `rgba(255,255,255,${((1 - t) ** 2 * (1 + 2 * t)).toFixed(3)})`);
  }
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

/** Axis-aligned box geometry centred at (x,y,z). */
function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): THREE.BufferGeometry {
  const b = new THREE.BoxGeometry(w, h, d);
  if (rotY) b.rotateY(rotY);
  b.translate(x, y, z);
  return b;
}

/** I-beam column (flanges + web) along Y. */
function iBeam(h: number, size: number, x: number, z: number, rotY = 0): THREE.BufferGeometry[] {
  const f = size, t = size * 0.12;
  const parts = [
    new THREE.BoxGeometry(f, h, t).translate(0, 0, f / 2 - t / 2),
    new THREE.BoxGeometry(f, h, t).translate(0, 0, -f / 2 + t / 2),
    new THREE.BoxGeometry(t, h, f),
  ];
  return parts.map((p) => p.rotateY(rotY).translate(x, h / 2, z));
}

/** Beam between two points (square section). */
function strut(a: THREE.Vector3, b: THREE.Vector3, s: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(s, len, s);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const m = a.clone().add(b).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

/** Merge geometries into one mesh and dispose the inputs. */
function merged(geos: THREE.BufferGeometry[], mat: THREE.Material, track: <T extends { dispose(): void }>(x: T) => T): THREE.Mesh {
  const mesh = new THREE.Mesh(track(mergeGeometries(geos)), mat);
  geos.forEach((g) => g.dispose());
  return mesh;
}

/** Probe position for the floor reflections (just above the floor, at the hall centre). */
const PROBE = new THREE.Vector3(0, 2, 0);

/**
 * Patch a standard material so its env-map lookups are box-projected onto the hall's walls (parallax-corrected
 * cube-map reflections): a cheap stand-in for a planar mirror on a polished floor.
 */
function boxProjected(mat: THREE.MeshStandardMaterial) {
  const { halfX: HX, halfZ: HZ, height: H } = HANGAR;
  const uniforms = {
    uBoxMin: { value: new THREE.Vector3(-HX, 0, -HZ) },
    uBoxMax: { value: new THREE.Vector3(HX, H, HZ) },
    uBoxCenter: { value: PROBE.clone() },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBoxWorldPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBoxWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBoxWorldPos;\nuniform vec3 uBoxMin;\nuniform vec3 uBoxMax;\nuniform vec3 uBoxCenter;')
      .replace('#include <envmap_physical_pars_fragment>', THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
        'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );',
        `reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
        {
          vec3 tA = ( uBoxMax - vBoxWorldPos ) / reflectVec;
          vec3 tB = ( uBoxMin - vBoxWorldPos ) / reflectVec;
          vec3 tF = max( tA, tB );
          float tHit = min( min( tF.x, tF.y ), tF.z );
          reflectVec = normalize( vBoxWorldPos + reflectVec * tHit - uBoxCenter );
        }`,
      ));
  };
  mat.customProgramCacheKey = () => 'hangar-box-projected';
}

export function buildHangar(renderer: THREE.WebGLRenderer): Hangar {
  const group = new THREE.Group();
  group.name = 'hangar';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const { halfX: HX, halfZ: HZ, height: H } = HANGAR;

  // ---------------------------------------------------------------- shared materials
  const steelMat = track(new THREE.MeshStandardMaterial({ color: 0x2b3442, roughness: 0.48, metalness: 0.75 }));
  const trimMat = track(new THREE.MeshStandardMaterial({ color: 0x1a212b, roughness: 0.6, metalness: 0.4 }));
  const accentMat = track(new THREE.MeshStandardMaterial({ color: 0x1f6a96, roughness: 0.42, metalness: 0.55 }));
  const lampMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff3e2).multiplyScalar(0.65) }));
  const cyanMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5cc8ff).multiplyScalar(0.38) }));

  // ---------------------------------------------------------------- floor: polished epoxy
  const floorMat = track(new THREE.MeshStandardMaterial({
    map: track(floorTexture(aniso)),
    roughnessMap: track(floorRoughness(aniso)),
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.38,
    color: 0x778795,
  }));
  boxProjected(floorMat);
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(FLOOR_W, FLOOR_W)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  group.add(floor);

  // ---------------------------------------------------------------- assembly platform (low turntable)
  const platMat = track(new THREE.MeshStandardMaterial({ map: track(platformTexture(aniso)), roughness: 0.58, metalness: 0.12, color: 0x687888, envMapIntensity: 0.35 }));
  boxProjected(platMat);
  // Side, top cap, bottom cap: the textured deck only on top.
  const plat = new THREE.Mesh(track(new THREE.CylinderGeometry(PLATFORM_R, PLATFORM_R + 0.12, PLATFORM_H, 96, 1)), [trimMat, platMat, trimMat]);
  plat.position.y = PLATFORM_H / 2;
  plat.receiveShadow = true;
  group.add(plat);
  const ringGeos = [
    new THREE.RingGeometry(PLATFORM_R - 0.32, PLATFORM_R - 0.22, 128, 1),
    new THREE.RingGeometry(PLATFORM_R * 0.45 - 0.04, PLATFORM_R * 0.45 + 0.04, 96, 1),
  ];
  const rings = merged(ringGeos, cyanMat, track);
  rings.rotation.x = -Math.PI / 2;
  rings.position.y = PLATFORM_H + 0.004;
  group.add(rings);

  // Soft contact shadow under the craft (multiplied over platform + floor).
  const blobMat = track(new THREE.MeshBasicMaterial({
    map: track(blobTexture()), color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false,
  }));
  const blob = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), blobMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = PLATFORM_H + 0.01;
  blob.renderOrder = 1;
  blob.visible = false;
  group.add(blob);

  // ---------------------------------------------------------------- walls
  const clad = track(claddingTexture(aniso));
  const wallMat = track(new THREE.MeshStandardMaterial({ map: clad, color: 0x66768b, roughness: 0.82, metalness: 0.15 }));
  const addWall = (w: number, h: number, pos: THREE.Vector3, rotY: number) => {
    const t = track(clad.clone());
    t.repeat.set(w / 4, h / 4);
    t.needsUpdate = true;
    const m = track(wallMat.clone());
    m.map = t;
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), m);
    mesh.position.copy(pos);
    mesh.rotation.y = rotY;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  addWall(HZ * 2, H, new THREE.Vector3(-HX, H / 2, 0), Math.PI / 2);
  addWall(HZ * 2, H, new THREE.Vector3(HX, H / 2, 0), -Math.PI / 2);
  addWall(HX * 2, H, new THREE.Vector3(0, H / 2, HZ), Math.PI);
  // Back wall (-Z) with the door opening: two side sections + lintel.
  const doorW = 34, doorH = 46;
  const sideW = HX - doorW / 2;
  addWall(sideW, H, new THREE.Vector3(-HX + sideW / 2, H / 2, -HZ), 0);
  addWall(sideW, H, new THREE.Vector3(HX - sideW / 2, H / 2, -HZ), 0);
  addWall(doorW, H - doorH, new THREE.Vector3(0, doorH + (H - doorH) / 2, -HZ), 0);

  // Ceiling
  const ceilMat = track(new THREE.MeshStandardMaterial({ color: 0x161c25, roughness: 0.9, metalness: 0.2 }));
  const ceil = new THREE.Mesh(track(new THREE.PlaneGeometry(HX * 2, HZ * 2)), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  group.add(ceil);

  // ---------------------------------------------------------------- hangar doors (slightly parted)
  const doorTex = track(doorTexture());
  const doorMat = track(new THREE.MeshStandardMaterial({ map: doorTex, color: 0x728397, roughness: 0.75, metalness: 0.25 }));
  const panels = 6, pw = doorW / panels;
  const doorGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < panels; i++) {
    const side = i < panels / 2 ? -1 : 1;
    const gap = 0.9; // the doors are parted a little, letting daylight in
    const x = -doorW / 2 + pw * (i + 0.5) + side * gap;
    const z = -HZ + 0.6 + (i % 3) * 0.7;
    doorGeos.push(boxAt(pw - 0.1, doorH, 0.4, x, doorH / 2, z));
  }
  const doors = merged(doorGeos, doorMat, track);
  doors.receiveShadow = true;
  group.add(doors);
  // Daylight slot between the doors
  const dayMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfe6ff).multiplyScalar(0.35) }));
  const slot = new THREE.Mesh(track(new THREE.PlaneGeometry(1.8, doorH)), dayMat);
  slot.position.set(0, doorH / 2, -HZ - 0.3);
  group.add(slot);

  // ---------------------------------------------------------------- steel frame (merged)
  const frame: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  const cyan: THREE.BufferGeometry[] = [];
  const colSpacing = 8.5;
  for (let z = -HZ + 4; z <= HZ - 2; z += colSpacing) {
    frame.push(...iBeam(H, 0.9, -HX + 0.5, z, 0));
    frame.push(...iBeam(H, 0.9, HX - 0.5, z, 0));
  }
  for (let x = -HX + 4; x <= HX - 2; x += colSpacing) {
    frame.push(...iBeam(H, 0.9, x, HZ - 0.5, Math.PI / 2));
  }
  for (const x of [-doorW / 2 - 0.8, doorW / 2 + 0.8]) frame.push(...iBeam(H, 1.4, x, -HZ + 0.7, Math.PI / 2));
  accent.push(boxAt(doorW + 3.2, 1.6, 1.6, 0, doorH + 0.8, -HZ + 0.8));
  // Horizontal wall girders
  for (const y of [18, 36]) {
    frame.push(boxAt(0.6, 0.8, HZ * 2, -HX + 1.0, y, 0));
    frame.push(boxAt(0.6, 0.8, HZ * 2, HX - 1.0, y, 0));
    frame.push(boxAt(HX * 2, 0.8, 0.6, 0, y, HZ - 1.0));
  }
  // Wainscot: dark base band around the hall, capped with a cyan light line.
  const baseH = 3.2;
  trim.push(boxAt(0.3, baseH, HZ * 2, -HX + 0.15, baseH / 2, 0));
  trim.push(boxAt(0.3, baseH, HZ * 2, HX - 0.15, baseH / 2, 0));
  trim.push(boxAt(HX * 2, baseH, 0.3, 0, baseH / 2, HZ - 0.15));
  for (const sx of [-1, 1]) trim.push(boxAt(sideW - 1.6, baseH, 0.3, sx * (HX - sideW / 2 + 0.8), baseH / 2, -HZ + 0.15));
  cyan.push(boxAt(0.05, 0.07, HZ * 2, -HX + 0.32, baseH + 0.04, 0));
  cyan.push(boxAt(0.05, 0.07, HZ * 2, HX - 0.32, baseH + 0.04, 0));
  cyan.push(boxAt(HX * 2, 0.07, 0.05, 0, baseH + 0.04, HZ - 0.32));
  for (const sx of [-1, 1]) cyan.push(boxAt(sideW - 1.6, 0.07, 0.05, sx * (HX - sideW / 2 + 0.8), baseH + 0.04, -HZ + 0.32));
  // Roof trusses spanning X
  for (let z = -HZ + 4; z <= HZ - 2; z += colSpacing) {
    const top = H - 0.6, bot = H - 4.5;
    frame.push(boxAt(HX * 2, 0.5, 0.5, 0, top, z));
    frame.push(boxAt(HX * 2, 0.5, 0.5, 0, bot, z));
    const n = 16;
    for (let i = 0; i < n; i++) {
      const x0 = -HX + (i / n) * HX * 2, x1 = -HX + ((i + 1) / n) * HX * 2;
      frame.push(strut(new THREE.Vector3(x0, bot, z), new THREE.Vector3(x1, top, z), 0.22));
      frame.push(strut(new THREE.Vector3(x1, bot, z), new THREE.Vector3(x1, top, z), 0.22));
    }
  }
  // Longitudinal purlins
  for (let x = -HX + 6; x <= HX - 6; x += 9) frame.push(boxAt(0.35, 0.35, HZ * 2, x, H - 0.6, 0));

  // Catwalks along both side walls at two levels, with railings and a cyan edge light.
  const grate: THREE.BufferGeometry[] = [];
  for (const y of [12, 26]) {
    for (const sx of [-1, 1]) {
      const x = sx * (HX - 2.6);
      grate.push(boxAt(3.4, 0.18, HZ * 2 - 4, x, y, 0));
      trim.push(boxAt(0.08, 0.4, HZ * 2 - 4, sx * (HX - 4.32), y - 0.1, 0));
      cyan.push(boxAt(0.03, 0.05, HZ * 2 - 4, sx * (HX - 4.37), y - 0.22, 0));
      const rx = sx * (HX - 4.25);
      accent.push(boxAt(0.12, 0.12, HZ * 2 - 4, rx, y + 1.1, 0));
      accent.push(boxAt(0.08, 0.08, HZ * 2 - 4, rx, y + 0.6, 0));
      for (let z = -HZ + 2; z <= HZ - 2; z += 2.4) accent.push(boxAt(0.1, 1.1, 0.1, rx, y + 0.55, z));
      for (let z = -HZ + 4; z <= HZ - 2; z += colSpacing) frame.push(strut(new THREE.Vector3(sx * (HX - 0.8), y - 2.8, z), new THREE.Vector3(rx, y - 0.1, z), 0.2));
    }
  }
  // Overhead crane bridge across the hall
  const craneZ = 6;
  accent.push(boxAt(HX * 2 - 3, 1.6, 1.0, 0, 44, craneZ - 1.3));
  accent.push(boxAt(HX * 2 - 3, 1.6, 1.0, 0, 44, craneZ + 1.3));
  frame.push(boxAt(3.2, 1.4, 3.6, 9, 43.3, craneZ));
  frame.push(boxAt(0.08, 14, 0.08, 9, 36, craneZ));
  frame.push(boxAt(1.2, 0.8, 0.6, 9, 29, craneZ));
  // Crane rails on the side girders
  frame.push(boxAt(0.8, 0.6, HZ * 2, -HX + 1.6, 43, 0));
  frame.push(boxAt(0.8, 0.6, HZ * 2, HX - 1.6, 43, 0));

  // Rear service gantry: original ochre lifting bridge and recessed work bays.
  // Fold into existing material batches; no extra lights, shadow casters or passes.
  const service: THREE.BufferGeometry[] = [];
  const serviceZ = -HZ + 7;
  for (const x of [-15, 15]) {
    frame.push(...iBeam(30, 0.65, x, serviceZ));
    trim.push(boxAt(2.4, 0.5, 2.6, x, 0.25, serviceZ));
    service.push(boxAt(0.8, 5, 0.8, x, 3, serviceZ));
    for (let y = 7; y < 28; y += 5) {
      frame.push(strut(new THREE.Vector3(x, y, serviceZ), new THREE.Vector3(x, y + 3, serviceZ - 3), 0.18));
    }
  }
  service.push(boxAt(31, 1.15, 0.8, 0, 29, serviceZ));
  trim.push(boxAt(31, 0.18, 1.4, 0, 28.35, serviceZ));
  for (const x of [-12, 12]) {
    trim.push(boxAt(2.2, 0.8, 1.6, x, 28, serviceZ));
    frame.push(boxAt(0.045, 7, 0.045, x - 0.2, 24.2, serviceZ), boxAt(0.045, 7, 0.045, x + 0.2, 24.2, serviceZ));
    service.push(boxAt(0.75, 0.7, 0.55, x, 20.6, serviceZ));
  }
  // Low service bays make the hall feel occupied even around a small starter craft.
  for (const x of [-24, -8, 8, 24]) {
    trim.push(boxAt(5.5, 3.8, 0.5, x, 1.9, -HZ + 0.5));
    lamps.push(boxAt(4.8, 0.08, 0.12, x, 4.2, -HZ + 0.9));
    service.push(boxAt(0.15, 3.8, 0.6, x - 2.85, 1.9, -HZ + 0.6));
  }
  const serviceMat = track(new THREE.MeshStandardMaterial({ color: 0x947047, roughness: 0.72, metalness: 0.25 }));
  group.add(merged(service, serviceMat, track));

  // ---------------------------------------------------------------- light fixtures
  // Linear LED high-bay runs along Z under the trusses: dark housing + emissive diffuser, between each truss pair.
  const lampY = H - 5.2;
  for (let z = -HZ + 4; z + colSpacing <= HZ - 2; z += colSpacing) {
    for (let x = -HX + 8; x <= HX - 8; x += 8) {
      const len = colSpacing - 2.2, zc = z + colSpacing / 2;
      trim.push(boxAt(0.9, 0.3, len + 0.2, x, lampY + 0.2, zc));
      lamps.push(boxAt(0.7, 0.06, len, x, lampY + 0.02, zc));
      frame.push(boxAt(0.05, 0.6, 0.05, x, lampY + 0.6, zc - len / 3), boxAt(0.05, 0.6, 0.05, x, lampY + 0.6, zc + len / 3));
    }
  }
  // Clerestory glazing high on the side walls: cool daylight panes between the columns, with mullions.
  const glass: THREE.BufferGeometry[] = [];
  const gy0 = 46.5, gy1 = 52.5;
  for (const sx of [-1, 1]) {
    const x = sx * (HX - 0.04);
    for (let z = -HZ + 4; z + colSpacing <= HZ - 2; z += colSpacing) {
      const len = colSpacing - 1.4, zc = z + colSpacing / 2;
      glass.push(boxAt(0.02, gy1 - gy0, len, x, (gy0 + gy1) / 2, zc));
      for (const f of [-1 / 6, 1 / 6, 0.5, -0.5]) trim.push(boxAt(0.25, gy1 - gy0, 0.12, sx * (HX - 0.1), (gy0 + gy1) / 2, zc + f * len));
      trim.push(boxAt(0.25, 0.14, len, sx * (HX - 0.1), (gy0 + gy1) / 2, zc));
    }
    trim.push(boxAt(0.5, 0.3, HZ * 2, sx * (HX - 0.2), gy0 - 0.15, 0), boxAt(0.5, 0.3, HZ * 2, sx * (HX - 0.2), gy1 + 0.15, 0));
  }
  const glassMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9cc4ec).multiplyScalar(0.55) }));
  group.add(merged(glass, glassMat, track));
  // Wall-washer strips above each catwalk.
  for (const sx of [-1, 1]) for (const y of [12, 26]) lamps.push(boxAt(0.1, 0.15, HZ * 2 - 6, sx * (HX - 0.3), y + 3.2, 0));

  const frameMesh = merged(frame, steelMat, track);
  frameMesh.receiveShadow = true;
  group.add(frameMesh);
  group.add(merged(accent, accentMat, track));
  const trimMesh = merged(trim, trimMat, track);
  trimMesh.receiveShadow = true;
  group.add(trimMesh);
  const grateMat = track(new THREE.MeshStandardMaterial({ color: 0x353e4b, roughness: 0.7, metalness: 0.6 }));
  group.add(merged(grate, grateMat, track));
  group.add(merged(lamps, lampMat, track));
  group.add(merged(cyan, cyanMat, track));

  // ---------------------------------------------------------------- signage
  const sign = new THREE.Mesh(
    track(new THREE.PlaneGeometry(26, 6.5)),
    track(new THREE.MeshBasicMaterial({ map: track(signTexture('WSP', 'VEHICLE ASSEMBLY · BAY 1')), transparent: true, depthWrite: false, toneMapped: false, color: 0xb0b8c4 })),
  );
  sign.position.set(-4, doorH + 5.5, -HZ + 0.05);
  group.add(sign);
  const sign2 = sign.clone();
  sign2.position.set(-HX + 0.06, 32, 6);
  sign2.rotation.y = Math.PI / 2;
  sign2.scale.setScalar(0.7);
  group.add(sign2);

  const baySign = new THREE.Mesh(
    track(new THREE.PlaneGeometry(12, 3)),
    track(new THREE.MeshBasicMaterial({ map: track(signTexture('01', 'INTEGRATION HALL')), transparent: true, depthWrite: false, color: 0x71818e })),
  );
  baySign.position.set(-24, 9, -HZ + 0.15);
  group.add(baySign);

  // ---------------------------------------------------------------- props: tool carts, crates
  const propMat = track(new THREE.MeshStandardMaterial({ color: 0x2b6f9e, roughness: 0.5, metalness: 0.3 }));
  const crateMat = track(new THREE.MeshStandardMaterial({ color: 0x5a6472, roughness: 0.75, metalness: 0.15 }));
  const props: THREE.BufferGeometry[] = [];
  const crates: THREE.BufferGeometry[] = [];
  const r = rng(11);
  for (let i = 0; i < 7; i++) {
    const x = (r() < 0.5 ? -1 : 1) * (HX - 4 - r() * 4), z = -HZ + 8 + r() * (HZ * 2 - 16);
    props.push(boxAt(1.6, 0.9, 0.9, x, 0.75, z), boxAt(1.6, 0.06, 0.9, x, 1.25, z));
    for (const [dx, dz] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]]) props.push(boxAt(0.08, 0.3, 0.08, x + dx, 0.15, z + dz));
  }
  for (let i = 0; i < 10; i++) {
    const x = (r() < 0.5 ? -1 : 1) * (HX - 3 - r() * 6), z = HZ - 4 - r() * 18, s = 0.8 + r() * 1.2;
    crates.push(boxAt(s, s, s, x, s / 2, z, r() * 0.6));
    if (r() < 0.4) crates.push(boxAt(s * 0.8, s * 0.8, s * 0.8, x, s + s * 0.4, z, r()));
  }
  const propMesh = merged(props, propMat, track);
  propMesh.castShadow = propMesh.receiveShadow = true;
  group.add(propMesh);
  const crateMesh = merged(crates, crateMat, track);
  crateMesh.castShadow = crateMesh.receiveShadow = true;
  group.add(crateMesh);

  return {
    group,
    setFootprint(rx, rz, lift) {
      const ok = rx > 0 && rz > 0 && Number.isFinite(lift);
      blob.visible = ok;
      if (!ok) return;
      // Higher crafts cast a wider, fainter occlusion; grounded ones a tight, darker one.
      const h = Math.max(0, lift - PLATFORM_H);
      const spread = 1.0 + h * 0.35;
      const max = (PLATFORM_R + 0.6) * 2;
      blob.scale.set(Math.min(max, rx * 2.2 + spread * 2), Math.min(max, rz * 2.2 + spread * 2), 1);
      blobMat.opacity = THREE.MathUtils.clamp(0.65 - h * 0.05, 0.2, 0.65);
    },
    bakeReflections(scene) {
      const hidden = [floor, plat, rings, blob];
      const vis = hidden.map((o) => o.visible);
      hidden.forEach((o) => (o.visible = false));
      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = track(pmrem.fromScene(scene, 0, 0.1, 250, { size: 256, position: PROBE }));
      pmrem.dispose();
      hidden.forEach((o, i) => (o.visible = vis[i]));
      for (const m of [floorMat, platMat]) {
        m.envMap = rt.texture;
        m.needsUpdate = true;
      }
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
