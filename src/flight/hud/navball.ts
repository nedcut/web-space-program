import { game } from '../../game/store';
import * as THREE from 'three';
import { releaseRenderer } from '../../render/releaseRenderer';
import { onContextRestored } from '../../render/core/contextRecovery';
import type { Vec3 } from '../../util/vec3';
import { dot } from '../../util/vec3';

/**
 * Attitude indicator ("navball"). Self-contained: owns a small WebGL canvas plus a 2D overlay for markers.
 *
 * Mapping: local horizon vectors (East, North, Up) map to ball space as x = -N, y = U, z = E, which matches
 * three's SphereGeometry UV layout (u=0 → -X = heading 0°, u=0.25 → +Z = heading 90°) and keeps headings
 * increasing to the right when viewed from outside the ball.
 */
export interface NavballFrame {
  /** Unit vectors in inertial space. */
  east: Vec3;
  north: Vec3;
  up: Vec3;
  /** Vessel nose direction (inertial unit) — centre of the ball. */
  forward: Vec3;
  /** Vessel "top" direction (inertial unit) — up on screen. */
  top: Vec3;
}

export type MarkerKind =
  | 'prograde' | 'retrograde' | 'normal' | 'antinormal' | 'radialOut' | 'radialIn'
  | 'target' | 'antiTarget' | 'maneuver';

export interface NavballMarker {
  kind: MarkerKind;
  /** Inertial unit direction. */
  dir: Vec3;
}

const MARKER_STYLE: Record<MarkerKind, { color: string; glyph: string }> = {
  prograde: { color: '#d8ff3c', glyph: 'pro' },
  retrograde: { color: '#d8ff3c', glyph: 'retro' },
  normal: { color: '#d066ff', glyph: 'tri-up' },
  antinormal: { color: '#d066ff', glyph: 'tri-down' },
  radialOut: { color: '#4fd8ff', glyph: 'radial-out' },
  radialIn: { color: '#4fd8ff', glyph: 'radial-in' },
  target: { color: '#ff4fb8', glyph: 'target' },
  antiTarget: { color: '#ff4fb8', glyph: 'anti-target' },
  maneuver: { color: '#3c8cff', glyph: 'maneuver' },
};
const MARKER_KINDS = Object.keys(MARKER_STYLE) as MarkerKind[];

function buildTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, H / 2);
  sky.addColorStop(0, '#0d4f8f');
  sky.addColorStop(1, '#3a9ad8');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H / 2);
  const ground = g.createLinearGradient(0, H / 2, 0, H);
  ground.addColorStop(0, '#b0702f');
  ground.addColorStop(1, '#4f2f12');
  g.fillStyle = ground;
  g.fillRect(0, H / 2, W, H / 2);

  // Pitch lines every 10°, labels every 30°.
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = 'bold 22px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let p = -80; p <= 80; p += 10) {
    const y = H / 2 - (p / 180) * H;
    g.lineWidth = p === 0 ? 5 : p % 30 === 0 ? 2.5 : 1.2;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
    if (p !== 0 && p % 30 === 0) {
      for (let h = 0; h < 360; h += 45) g.fillText(`${Math.abs(p)}`, ((h + 22.5) / 360) * W, y - 14 * Math.sign(p));
    }
  }
  // Heading meridians every 15°, labels every 45°.
  for (let h = 0; h < 360; h += 15) {
    const x = (h / 360) * W;
    g.lineWidth = h % 90 === 0 ? 3 : h % 45 === 0 ? 2 : 1;
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.moveTo(x, H * 0.06);
    g.lineTo(x, H * 0.94);
    g.stroke();
  }
  g.font = 'bold 30px system-ui, sans-serif';
  const card: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let h = 0; h < 360; h += 45) {
    const x = (h / 360) * W;
    const label = card[h] ?? String(h).padStart(3, '0');
    for (const y of [H / 2 - 30, H / 2 + 30]) {
      g.fillStyle = card[h] ? '#ffffff' : 'rgba(255,255,255,0.85)';
      g.fillText(label, x, y);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Navball {
  readonly element: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
  private overlay: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size: number;
  /** Last drawn state (ball axes, marker positions, colour scheme); identical frames are skipped. */
  private lastKey = new Float64Array(0);
  private lastColourBlind = false;
  private bezel: CanvasGradient | null = null;
  private readonly unwatchContext: () => void;

  constructor(size = 210) {
    this.size = size;
    this.element = document.createElement('div');
    Object.assign(this.element.style, { position: 'relative', width: `${size}px`, height: `${size}px` });

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(size, size);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', borderRadius: '50%' });
    this.element.appendChild(this.renderer.domElement);
    // A restored context starts with a blank canvas; unchanged-frame skipping would leave it that way.
    this.unwatchContext = onContextRestored(this.renderer, () => { this.lastKey = new Float64Array(0); });

    this.overlay = document.createElement('canvas');
    this.overlay.width = size * devicePixelRatio;
    this.overlay.height = size * devicePixelRatio;
    Object.assign(this.overlay.style, { position: 'absolute', inset: '0', width: `${size}px`, height: `${size}px`, pointerEvents: 'none' });
    this.element.appendChild(this.overlay);
    this.ctx = this.overlay.getContext('2d')!;

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 48),
      new THREE.MeshStandardMaterial({ map: buildTexture(), roughness: 0.55, metalness: 0.0 }),
    );
    this.scene.add(ball);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    this.scene.add(key);
    this.camera.add(key);
    key.position.set(-1, 1, 2);
    this.scene.add(this.camera);
    // Fit the unit ball to the viewport.
    this.camera.position.set(0, 0, 1 / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }

  private toBall(f: NavballFrame, d: Vec3): THREE.Vector3 {
    return new THREE.Vector3(-dot(d, f.north), dot(d, f.up), dot(d, f.east));
  }

  /** True when nothing visible changed since the last draw (common on the pad / while coasting). */
  private unchanged(frame: NavballFrame, markers: NavballMarker[], colourBlind: boolean): boolean {
    const n = 16 + markers.length * 4;
    let key = this.lastKey;
    const same = key.length === n && colourBlind === this.lastColourBlind;
    if (key.length !== n) key = this.lastKey = new Float64Array(n);
    let changed = !same;
    const put = (i: number, v: number) => { if (Math.abs(key[i] - v) > 1e-6) { key[i] = v; changed = true; } };
    const vecs = [frame.east, frame.north, frame.up, frame.forward, frame.top];
    for (let k = 0; k < 5; k++) { put(k * 3, vecs[k].x); put(k * 3 + 1, vecs[k].y); put(k * 3 + 2, vecs[k].z); }
    put(15, markers.length);
    for (let m = 0; m < markers.length; m++) {
      const b = 16 + m * 4, mk = markers[m];
      put(b, MARKER_KINDS.indexOf(mk.kind)); put(b + 1, mk.dir.x); put(b + 2, mk.dir.y); put(b + 3, mk.dir.z);
    }
    this.lastColourBlind = colourBlind;
    return !changed;
  }

  update(frame: NavballFrame, markers: NavballMarker[]) {
    const colourBlind = game.get().settings.colourBlind;
    if (this.unchanged(frame, markers, colourBlind)) return;
    const fwd = this.toBall(frame, frame.forward).normalize();
    const top = this.toBall(frame, frame.top).normalize();
    const dist = this.camera.position.length();
    this.camera.position.copy(fwd).multiplyScalar(dist);
    this.camera.up.copy(top);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);

    const ctx = this.ctx;
    const s = this.overlay.width;
    ctx.clearRect(0, 0, s, s);
    // Bezel shading.
    if (!this.bezel) {
      this.bezel = ctx.createRadialGradient(s / 2, s / 2, s * 0.38, s / 2, s / 2, s * 0.5);
      this.bezel.addColorStop(0, 'rgba(0,0,0,0)');
      this.bezel.addColorStop(1, 'rgba(0,0,0,0.55)');
    }
    ctx.fillStyle = this.bezel;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.fill();

    const v = new THREE.Vector3();
    for (const m of markers) {
      v.copy(this.toBall(frame, m.dir)).normalize();
      if (v.dot(fwd) < 0.05) continue; // behind the ball
      v.project(this.camera);
      drawMarker(ctx, (v.x * 0.5 + 0.5) * s, (-v.y * 0.5 + 0.5) * s, s / 210, { ...MARKER_STYLE[m.kind], color: colourBlind ? ({ prograde: '#f0e442', retrograde: '#f0e442', normal: '#ffffff', antinormal: '#ffffff', radialOut: '#56b4e9', radialIn: '#56b4e9', target: '#e69f00', antiTarget: '#e69f00', maneuver: '#cc79a7' }[m.kind]) : MARKER_STYLE[m.kind].color });
    }
    // Fixed vessel reticle.
    ctx.strokeStyle = '#ffb000';
    ctx.lineWidth = 3 * (s / 210);
    const c = s / 2;
    const k = s / 210;
    ctx.beginPath();
    ctx.moveTo(c - 34 * k, c);
    ctx.lineTo(c - 12 * k, c);
    ctx.lineTo(c, c + 10 * k);
    ctx.lineTo(c + 12 * k, c);
    ctx.lineTo(c + 34 * k, c);
    ctx.moveTo(c, c - 4 * k);
    ctx.lineTo(c, c - 14 * k);
    ctx.stroke();
    // Heading box (compass heading of the nose), readable at a glance like the ball's tick marks.
    const heading = ((Math.atan2(dot(frame.forward, frame.east), dot(frame.forward, frame.north)) * 180) / Math.PI + 360) % 360;
    const label = `${Math.round(heading) % 360}`.padStart(3, '0') + '°';
    ctx.font = `bold ${13 * k}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 12 * k;
    ctx.fillStyle = 'rgba(4, 12, 22, 0.78)';
    ctx.strokeStyle = 'rgba(121, 215, 238, 0.7)';
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath();
    ctx.roundRect(c - w / 2, 4 * k, w, 18 * k, 4 * k);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e8f0f6';
    ctx.fillText(label, c, 13.5 * k);
  }

  dispose() {
    this.unwatchContext();
    releaseRenderer(this.renderer, this.scene);
    this.element.remove();
  }

  get pixelSize() {
    return this.size;
  }
}

function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, st: { color: string; glyph: string }) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.strokeStyle = st.color;
  ctx.fillStyle = st.color;
  ctx.lineWidth = 2.2;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 3;
  const circle = (r: number) => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  switch (st.glyph) {
    case 'pro':
      circle(7);
      ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();
      line(-7, 0, -14, 0); line(7, 0, 14, 0); line(0, -7, 0, -14);
      break;
    case 'retro':
      circle(7);
      line(-5, -5, 5, 5); line(-5, 5, 5, -5);
      line(-5, 5, -11, 11); line(5, 5, 11, 11); line(0, -7, 0, -14);
      break;
    case 'tri-up':
    case 'tri-down': {
      const sgn = st.glyph === 'tri-up' ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(0, -8 * sgn); ctx.lineTo(7, 5 * sgn); ctx.lineTo(-7, 5 * sgn); ctx.closePath();
      ctx.stroke();
      if (sgn < 0) { line(0, -8 * sgn, 0, -14 * sgn); }
      ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'radial-out':
      circle(6);
      for (const a of [45, 135, 225, 315]) {
        const r = (a * Math.PI) / 180;
        line(Math.cos(r) * 6, Math.sin(r) * 6, Math.cos(r) * 12, Math.sin(r) * 12);
      }
      break;
    case 'radial-in':
      circle(9);
      for (const a of [45, 135, 225, 315]) {
        const r = (a * Math.PI) / 180;
        line(Math.cos(r) * 9, Math.sin(r) * 9, Math.cos(r) * 4, Math.sin(r) * 4);
      }
      break;
    case 'target':
    case 'anti-target':
      circle(7);
      line(-10, 0, -4, 0); line(10, 0, 4, 0); line(0, -10, 0, -4); line(0, 10, 0, 4);
      if (st.glyph === 'anti-target') { line(-5, -5, 5, 5); line(-5, 5, 5, -5); }
      break;
    case 'maneuver':
      ctx.lineWidth = 3;
      circle(8);
      line(0, -8, 0, -15); line(-7, 4, -13, 8); line(7, 4, 13, 8);
      break;
  }
  ctx.restore();
}
