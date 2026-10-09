import * as THREE from 'three';
import { onContextRestored } from './contextRecovery';

/**
 * Procedural studio environment for image-based lighting, baked once through PMREM.
 *
 * Replaces three's generic RoomEnvironment with a lighting setup designed for part materials: a dim room, big
 * warm overhead softbox strips (broad top highlights on painted tanks), a cooler side panel (cool edge on metal
 * and foil), a key softbox matching the direct key light, a subtle warm rim from behind and a mid-grey floor for
 * bounce. Deterministic and cheap: a handful of quads rendered once into a cube map, then disposed.
 */

export type StudioVariant = 'hangar' | 'thumbnail' | 'preview';

interface Panel {
  /** Size (w, h) in metres. */
  w: number;
  h: number;
  /** Centre position. */
  pos: [number, number, number];
  /** Point the panel faces (defaults to the origin). */
  look?: [number, number, number];
  color: number;
  intensity: number;
}

interface Preset {
  /** Room half-size (x, z), ceiling height and floor depth below the bake point. */
  half: number;
  ceil: number;
  floor: number;
  walls: number;
  wallI: number;
  ceiling: number;
  ceilingI: number;
  ground: number;
  groundI: number;
  panels: Panel[];
  sigma: number;
}

const WARM = 0xfff2e2;
const COOL = 0xcfe2ff;
const RIM = 0xffd6a8;
const CYAN = 0x5cc8ff;

function overheadStrips(n: number, gap: number, w: number, len: number, y: number, intensity: number): Panel[] {
  const out: Panel[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * gap;
    out.push({ w, h: len, pos: [x, y, 0], look: [x, 0, 0], color: WARM, intensity });
  }
  return out;
}

const PRESETS: Record<StudioVariant, Preset> = {
  // Dim, moody hall: navy-slate walls, warm overhead strips, cool side panel, warm rim and a faint cyan accent.
  hangar: {
    half: 20, ceil: 13, floor: 3,
    walls: 0x223042, wallI: 0.55, ceiling: 0x141b26, ceilingI: 0.6, ground: 0x5a6068, groundI: 0.55,
    panels: [
      ...overheadStrips(4, 6, 1.6, 26, 12.9, 6),
      { w: 7, h: 7, pos: [18, 10, 4], color: WARM, intensity: 5 },
      { w: 10, h: 6, pos: [-19.9, 4, 3], color: COOL, intensity: 2.6 },
      { w: 18, h: 1.4, pos: [0, 7, -19.9], color: RIM, intensity: 4 },
      { w: 30, h: 0.25, pos: [0, -1.6, 19.9], color: CYAN, intensity: 2.2 },
      { w: 30, h: 0.25, pos: [19.9, -1.6, 0], look: [0, -1.6, 0], color: CYAN, intensity: 2.2 },
    ],
    sigma: 0.035,
  },
  // Bright, clean product shot: light-grey cyclorama, large top softbox, key + fill + double rim.
  thumbnail: {
    half: 14, ceil: 10, floor: 2.5,
    walls: 0x8a929e, wallI: 0.7, ceiling: 0x9aa2ae, ceilingI: 0.6, ground: 0x8c9098, groundI: 0.75,
    panels: [
      { w: 14, h: 14, pos: [0, 9.9, 0], color: WARM, intensity: 4.5 },
      { w: 8, h: 8, pos: [9, 6, 9], color: WARM, intensity: 6 },
      { w: 7, h: 6, pos: [-13.9, 3, 4], color: COOL, intensity: 3.5 },
      { w: 3, h: 9, pos: [8, 4, -13.9], color: RIM, intensity: 5 },
      { w: 3, h: 9, pos: [-8, 4, -13.9], color: COOL, intensity: 4 },
    ],
    sigma: 0.03,
  },
  // Parts gallery: dark studio with clear, readable highlights.
  preview: {
    half: 18, ceil: 12, floor: 3,
    walls: 0x2a3444, wallI: 0.6, ceiling: 0x1c2430, ceilingI: 0.6, ground: 0x60666e, groundI: 0.6,
    panels: [
      ...overheadStrips(3, 6, 2.2, 22, 11.9, 6),
      { w: 8, h: 8, pos: [12, 8, 12], color: WARM, intensity: 6 },
      { w: 8, h: 6, pos: [-17.9, 3.5, 4], color: COOL, intensity: 3 },
      { w: 16, h: 1.6, pos: [0, 6, -17.9], color: RIM, intensity: 4.5 },
    ],
    sigma: 0.035,
  },
};

/**
 * Bake the studio scene into a PMREM render target suitable for `scene.environment`. The caller owns the result
 * (dispose it with the scene). Temporary geometry, materials and the PMREM generator are disposed here.
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer, opts: { variant?: StudioVariant } = {}): THREE.WebGLRenderTarget {
  const p = PRESETS[opts.variant ?? 'hangar'];
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const basic = (color: number, intensity: number, side: THREE.Side = THREE.FrontSide) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side, fog: false, toneMapped: false });
    disposables.push(m);
    return m;
  };

  // Room shell: one inward-facing box; per-face materials (+x, -x, +y, -y, +z, -z).
  const H = p.ceil + p.floor;
  const room = new THREE.BoxGeometry(p.half * 2, H, p.half * 2);
  disposables.push(room);
  const wall = basic(p.walls, p.wallI, THREE.BackSide);
  const shell = new THREE.Mesh(room, [wall, wall, basic(p.ceiling, p.ceilingI, THREE.BackSide), basic(p.ground, p.groundI, THREE.BackSide), wall, wall]);
  shell.position.y = (p.ceil - p.floor) / 2;
  scene.add(shell);

  const quad = new THREE.PlaneGeometry(1, 1);
  disposables.push(quad);
  const target = new THREE.Vector3();
  for (const pan of p.panels) {
    const m = new THREE.Mesh(quad, basic(pan.color, pan.intensity, THREE.DoubleSide));
    m.scale.set(pan.w, pan.h, 1);
    m.position.set(...pan.pos);
    target.set(...(pan.look ?? [0, 0, 0]));
    // Ceiling panels look straight down (lookAt would be degenerate): lay them flat, long axis along Z.
    if (target.x === pan.pos[0] && target.z === pan.pos[2]) m.rotation.x = Math.PI / 2;
    else m.lookAt(target);
    scene.add(m);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, p.sigma, 0.1, 200);
  pmrem.dispose();
  for (const d of disposables) d.dispose();
  return rt;
}

/**
 * A studio environment that survives WebGL context loss: baked now and again after every restore (the PMREM target's
 * pixels are GPU-only). `apply` receives each new target and should point the scene's `environment` at it; the
 * previous target is disposed here.
 */
export class StudioEnvironment {
  target: THREE.WebGLRenderTarget;
  private readonly off: () => void;

  constructor(renderer: THREE.WebGLRenderer, opts: { variant?: StudioVariant }, apply: (target: THREE.WebGLRenderTarget) => void) {
    this.target = createStudioEnvironment(renderer, opts);
    apply(this.target);
    this.off = onContextRestored(renderer, () => {
      const next = createStudioEnvironment(renderer, opts);
      apply(next);
      this.target.dispose();
      this.target = next;
    });
  }

  dispose(): void {
    this.off();
    this.target.dispose();
  }
}
