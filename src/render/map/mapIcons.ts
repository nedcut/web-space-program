import * as THREE from 'three';
import type { GizmoAxis } from './maneuverGizmo';

/** Gizmo handle colours: prograde green, normal magenta, radial cyan (shared with the node menu). */
export const AXIS_COLORS: Record<GizmoAxis, string> = { prograde: '#8fe84a', normal: '#d86bff', radial: '#45d8f2' };
export const NODE_COLOR = '#4d9dff';
export const PLANNED_COLOR = 0xff9d3c;
export const PLANNED_CSS = '#ff9d3c';

const cache = new Map<string, THREE.CanvasTexture>();

/** Original canvas glyphs; only primitive path calls so headless DOM stubs can construct them. */
function texture(key: string, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

function ring(g: CanvasRenderingContext2D, r: number, width: number) {
  g.lineWidth = width;
  g.beginPath();
  g.arc(32, 32, r, 0, Math.PI * 2);
  g.stroke();
}

function poly(g: CanvasRenderingContext2D, pts: [number, number][], fill: boolean) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
  g.lineTo(pts[0][0], pts[0][1]);
  if (fill) g.fill(); else g.stroke();
}

/**
 * Handle glyphs: prograde = ring with a centre dot, retrograde = ring with a cross; normal = solid up-triangle,
 * anti-normal = hollow down-triangle; radial out = ring with outward ticks, radial in = ring with inward ticks.
 */
export function handleTexture(axis: GizmoAxis, sign: number): THREE.CanvasTexture {
  const color = AXIS_COLORS[axis];
  return texture(`handle:${axis}:${sign}`, g => {
    g.strokeStyle = color; g.fillStyle = color; g.lineCap = 'round';
    // Dark halo keeps handles readable over bright planets.
    g.strokeStyle = 'rgba(0,0,0,0.55)'; ring(g, 21, 11);
    g.strokeStyle = color;
    if (axis === 'prograde') {
      ring(g, 19, 6);
      if (sign > 0) { g.beginPath(); g.arc(32, 32, 7, 0, Math.PI * 2); g.fill(); }
      else { g.lineWidth = 6; g.beginPath(); g.moveTo(24, 24); g.lineTo(40, 40); g.moveTo(40, 24); g.lineTo(24, 40); g.stroke(); }
    } else if (axis === 'normal') {
      g.lineWidth = 6;
      if (sign > 0) poly(g, [[32, 10], [54, 48], [10, 48]], true);
      else poly(g, [[32, 52], [12, 17], [52, 17]], false);
    } else {
      ring(g, 13, 6);
      g.lineWidth = 6;
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4, r0 = sign > 0 ? 17 : 5, r1 = sign > 0 ? 29 : 11;
        g.moveTo(32 + Math.cos(a) * r0, 32 + Math.sin(a) * r0);
        g.lineTo(32 + Math.cos(a) * r1, 32 + Math.sin(a) * r1);
      }
      g.stroke();
    }
  });
}

/** Maneuver node: a diamond; `ghost` is the hover preview on the orbit. */
export function nodeTexture(state: 'node' | 'selected' | 'ghost'): THREE.CanvasTexture {
  return texture(`node:${state}`, g => {
    const color = state === 'ghost' ? 'rgba(160,205,255,0.85)' : NODE_COLOR;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    poly(g, [[32, 2], [62, 32], [32, 62], [2, 32]], true);
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 6;
    poly(g, [[32, 7], [57, 32], [32, 57], [7, 32]], state !== 'ghost');
    if (state === 'selected') { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(32, 32, 7, 0, Math.PI * 2); g.fill(); }
    if (state === 'ghost') { g.lineWidth = 5; g.beginPath(); g.moveTo(32, 20); g.lineTo(32, 44); g.moveTo(20, 32); g.lineTo(44, 32); g.stroke(); }
  });
}
