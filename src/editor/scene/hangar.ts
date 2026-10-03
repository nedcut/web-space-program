import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural vehicle-assembly hall. Everything is generated: canvas textures for the floor and wall cladding,
 * merged box geometry for the steel frame, emissive panels for lighting. A handful of draw calls total.
 */

export const HANGAR = { halfX: 36, halfZ: 34, height: 56 } as const;

export interface Hangar {
  group: THREE.Group;
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

function floorTexture(maxAniso: number): THREE.Texture {
  const S = 2048;
  const { c, g } = canvas(S, S);
  const r = rng(7);
  const W = HANGAR.halfX * 2; // metres across
  const px = S / W;
  // Base: warm grey polished concrete with mottling.
  g.fillStyle = '#5d6168';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = r() * S, y = r() * S, rad = 6 + r() * 60;
    const l = 82 + r() * 26;
    g.fillStyle = `rgba(${l},${l + 3},${l + 8},${0.035 + r() * 0.05})`;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 9000; i++) {
    const l = r() < 0.5 ? 40 : 140;
    g.fillStyle = `rgba(${l},${l},${l},${0.08 + r() * 0.1})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  // Slab joints every 4 m, fine grid every metre.
  g.strokeStyle = 'rgba(255,255,255,0.035)';
  g.lineWidth = 1;
  for (let m = 0; m <= W; m += 1) {
    g.beginPath(); g.moveTo(m * px, 0); g.lineTo(m * px, S); g.stroke();
    g.beginPath(); g.moveTo(0, m * px); g.lineTo(S, m * px); g.stroke();
  }
  g.strokeStyle = 'rgba(20,22,26,0.55)';
  g.lineWidth = 2.5;
  for (let m = 0; m <= W; m += 4) {
    g.beginPath(); g.moveTo(m * px, 0); g.lineTo(m * px, S); g.stroke();
    g.beginPath(); g.moveTo(0, m * px); g.lineTo(S, m * px); g.stroke();
  }
  const cx = S / 2, cy = S / 2;
  // Central assembly pad: darker disc, hazard ring, cross-hairs, radial ticks.
  const pad = 9 * px;
  const grad = g.createRadialGradient(cx, cy, pad * 0.2, cx, cy, pad);
  grad.addColorStop(0, '#3b3f46');
  grad.addColorStop(1, '#43474e');
  g.fillStyle = grad;
  g.beginPath(); g.arc(cx, cy, pad, 0, Math.PI * 2); g.fill();
  // Hazard ring
  const inner = pad, outer = pad + 0.6 * px;
  const n = 72;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2;
    g.fillStyle = '#e0b230';
    g.beginPath();
    g.arc(cx, cy, outer, a0, a1);
    g.arc(cx, cy, inner, a1, a0, true);
    g.closePath(); g.fill();
    g.fillStyle = '#1b1c1f';
    g.beginPath();
    g.arc(cx, cy, outer, a1, a0 + (Math.PI * 2) / n);
    g.arc(cx, cy, inner, a0 + (Math.PI * 2) / n, a1, true);
    g.closePath(); g.fill();
  }
  g.strokeStyle = 'rgba(92,200,255,0.55)';
  g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, pad * 0.55, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(230,237,247,0.45)';
  g.lineWidth = 2;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const l0 = pad * (i % 9 === 0 ? 0.62 : 0.8), l1 = pad * 0.95;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * l0, cy + Math.sin(a) * l0); g.lineTo(cx + Math.cos(a) * l1, cy + Math.sin(a) * l1); g.stroke();
  }
  g.beginPath(); g.moveTo(cx - pad * 0.3, cy); g.lineTo(cx + pad * 0.3, cy); g.moveTo(cx, cy - pad * 0.3); g.lineTo(cx, cy + pad * 0.3); g.stroke();
  // Painted lanes toward the doors (-Z = top of the texture) and walkway borders.
  g.fillStyle = 'rgba(224,178,48,0.85)';
  const lane = 15 * px;
  for (const sx of [-1, 1]) {
    for (let y = 0; y < cy - outer - 1 * px; y += 1.6 * px) g.fillRect(cx + sx * lane - 0.12 * px, y, 0.24 * px, 0.9 * px);
  }
  g.fillStyle = 'rgba(230,237,247,0.6)';
  for (const sx of [-1, 1]) g.fillRect(cx + sx * (W / 2 - 6) * px - 0.1 * px, 0, 0.2 * px, S);
  // Stencilled bay marker
  g.save();
  g.translate(cx, cy + pad + 4.2 * px);
  g.fillStyle = 'rgba(230,237,247,0.5)';
  g.font = `700 ${Math.round(1.6 * px)}px Inter, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ASSEMBLY BAY 1', 0, 0);
  g.restore();
  // Tyre / scuff marks
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(20,20,22,${0.05 + r() * 0.07})`;
    g.lineWidth = 2 + r() * 8;
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

function claddingTexture(maxAniso: number): THREE.Texture {
  const { c, g } = canvas(256, 512);
  g.fillStyle = '#7d858f';
  g.fillRect(0, 0, 256, 512);
  // Vertical ribs of trapezoidal cladding.
  for (let x = 0; x < 256; x += 32) {
    const grd = g.createLinearGradient(x, 0, x + 32, 0);
    grd.addColorStop(0, '#6c737c');
    grd.addColorStop(0.2, '#9aa2ac');
    grd.addColorStop(0.35, '#848c96');
    grd.addColorStop(0.8, '#727a83');
    grd.addColorStop(1, '#5f666e');
    g.fillStyle = grd;
    g.fillRect(x, 0, 32, 512);
  }
  // Horizontal sheet seams + grime.
  g.fillStyle = 'rgba(30,32,36,0.45)';
  g.fillRect(0, 0, 256, 3);
  const r = rng(3);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(40,40,44,${r() * 0.05})`;
    g.fillRect(r() * 256, r() * 512, 2 + r() * 20, 10 + r() * 80);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

function doorTexture(): THREE.Texture {
  const { c, g } = canvas(512, 1024);
  g.fillStyle = '#9aa3ad';
  g.fillRect(0, 0, 512, 1024);
  // Horizontal ribbing
  for (let y = 0; y < 1024; y += 16) {
    g.fillStyle = y % 32 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
    g.fillRect(0, y, 512, 8);
  }
  // Panel frames
  g.strokeStyle = 'rgba(40,44,50,0.8)';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 504, 1016);
  for (let y = 128; y < 1024; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  // Hazard band at the bottom
  for (let x = -64; x < 512; x += 48) {
    g.fillStyle = '#e0b230';
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

export function buildHangar(renderer: THREE.WebGLRenderer): Hangar {
  const group = new THREE.Group();
  group.name = 'hangar';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const { halfX: HX, halfZ: HZ, height: H } = HANGAR;

  // ---------------------------------------------------------------- floor
  const floorMat = track(new THREE.MeshStandardMaterial({ map: track(floorTexture(aniso)), roughness: 0.42, metalness: 0.0 }));
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(HX * 2, HX * 2)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  group.add(floor);

  // ---------------------------------------------------------------- walls
  const clad = track(claddingTexture(aniso));
  const wallMat = track(new THREE.MeshStandardMaterial({ map: clad, roughness: 0.62, metalness: 0.35, color: 0xa4adb8 }));
  const addWall = (w: number, h: number, pos: THREE.Vector3, rotY: number, repX: number) => {
    const t = clad.clone();
    t.repeat.set(repX, h / 14);
    t.needsUpdate = true;
    track(t);
    const m = wallMat.clone();
    m.map = t;
    track(m);
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), m);
    mesh.position.copy(pos);
    mesh.rotation.y = rotY;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  addWall(HZ * 2, H, new THREE.Vector3(-HX, H / 2, 0), Math.PI / 2, HZ / 4);
  addWall(HZ * 2, H, new THREE.Vector3(HX, H / 2, 0), -Math.PI / 2, HZ / 4);
  addWall(HX * 2, H, new THREE.Vector3(0, H / 2, HZ), Math.PI, HX / 4);
  // Back wall (-Z) with the door opening: two side sections + lintel.
  const doorW = 34, doorH = 46;
  const sideW = HX - doorW / 2;
  addWall(sideW, H, new THREE.Vector3(-HX + sideW / 2, H / 2, -HZ), 0, sideW / 4);
  addWall(sideW, H, new THREE.Vector3(HX - sideW / 2, H / 2, -HZ), 0, sideW / 4);
  addWall(doorW, H - doorH, new THREE.Vector3(0, doorH + (H - doorH) / 2, -HZ), 0, doorW / 4);

  // Ceiling
  const ceilMat = track(new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.9, metalness: 0.2 }));
  const ceil = new THREE.Mesh(track(new THREE.PlaneGeometry(HX * 2, HZ * 2)), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  group.add(ceil);

  // ---------------------------------------------------------------- hangar doors (slightly parted)
  const doorTex = track(doorTexture());
  const doorMat = track(new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.5, metalness: 0.55 }));
  const panels = 6, pw = doorW / panels;
  const doorGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < panels; i++) {
    const side = i < panels / 2 ? -1 : 1;
    const gap = 0.9; // the doors are parted a little, letting daylight in
    const x = -doorW / 2 + pw * (i + 0.5) + side * gap;
    const z = -HZ + 0.6 + (i % 3) * 0.7;
    doorGeos.push(boxAt(pw - 0.1, doorH, 0.4, x, doorH / 2, z));
  }
  const doors = new THREE.Mesh(track(mergeGeometries(doorGeos)), doorMat);
  doors.castShadow = false;
  doors.receiveShadow = true;
  group.add(doors);
  doorGeos.forEach((g) => g.dispose());
  // Daylight slot between the doors
  const dayMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfe6ff).multiplyScalar(2.2) }));
  const slot = new THREE.Mesh(track(new THREE.PlaneGeometry(1.8, doorH)), dayMat);
  slot.position.set(0, doorH / 2, -HZ - 0.3);
  group.add(slot);
  // Door rail / header beam
  const steelMat = track(new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.45, metalness: 0.85 }));
  const accentMat = track(new THREE.MeshStandardMaterial({ color: 0x1f5f8a, roughness: 0.5, metalness: 0.6 }));

  // ---------------------------------------------------------------- steel frame (merged)
  const frame: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
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

  // Catwalks along both side walls at two levels, with railings.
  const grate: THREE.BufferGeometry[] = [];
  for (const y of [12, 26]) {
    for (const sx of [-1, 1]) {
      const x = sx * (HX - 2.6);
      grate.push(boxAt(3.4, 0.18, HZ * 2 - 4, x, y, 0));
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

  const frameMesh = new THREE.Mesh(track(mergeGeometries(frame)), steelMat);
  frameMesh.receiveShadow = true;
  group.add(frameMesh);
  const accentMesh = new THREE.Mesh(track(mergeGeometries(accent)), accentMat);
  group.add(accentMesh);
  const grateMat = track(new THREE.MeshStandardMaterial({ color: 0x4a515b, roughness: 0.7, metalness: 0.6 }));
  group.add(new THREE.Mesh(track(mergeGeometries(grate)), grateMat));
  frame.forEach((g) => g.dispose());
  accent.forEach((g) => g.dispose());
  grate.forEach((g) => g.dispose());

  // ---------------------------------------------------------------- light fixtures (emissive)
  const lampMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e0).multiplyScalar(3) }));
  const lamps: THREE.BufferGeometry[] = [];
  for (let z = -HZ + 4; z <= HZ - 2; z += colSpacing) {
    for (let x = -HX + 7; x <= HX - 7; x += 7) lamps.push(boxAt(2.6, 0.12, 0.7, x, H - 4.9, z));
  }
  // Wall-washer strips above each catwalk
  for (const sx of [-1, 1]) for (const y of [12, 26]) lamps.push(boxAt(0.1, 0.15, HZ * 2 - 6, sx * (HX - 0.3), y + 3.2, 0));
  group.add(new THREE.Mesh(track(mergeGeometries(lamps)), lampMat));
  lamps.forEach((g) => g.dispose());

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

  // ---------------------------------------------------------------- props: tool carts, crates, stands
  const propMat = track(new THREE.MeshStandardMaterial({ color: 0x2b6f9e, roughness: 0.55, metalness: 0.3 }));
  const crateMat = track(new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 0.85, metalness: 0.0 }));
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
  const propMesh = new THREE.Mesh(track(mergeGeometries(props)), propMat);
  propMesh.castShadow = propMesh.receiveShadow = true;
  group.add(propMesh);
  const crateMesh = new THREE.Mesh(track(mergeGeometries(crates)), crateMat);
  crateMesh.castShadow = crateMesh.receiveShadow = true;
  group.add(crateMesh);
  props.forEach((g) => g.dispose());
  crates.forEach((g) => g.dispose());

  return {
    group,
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
