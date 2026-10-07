import * as THREE from 'three';
import type { PartDef } from '../../sim/vessel/types';
import { LIVERIES, drawLogo, liveryFor, type LiveryId } from './livery';

/**
 * Decal atlas: manufacturer logos and wordmarks, stencilled markings, part-number plates, hazard
 * bands and symbols, all drawn procedurally into one shared Canvas 2D atlas. Every decal in every
 * part uses the single `decalMaterial()` (alpha-tested, opaque pass), so decals merge into the
 * vessel's static batches instead of adding transparent draw calls.
 *
 * Regions are allocated lazily (shelf packer) and the atlas texture re-uploads once per burst of
 * allocations. Headless, regions are estimated and nothing is drawn.
 */

export interface Region {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** width / height of the drawn content. */
  aspect: number;
}

const W = 2048;
const H = 2048;
const PAD = 4;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let texture: THREE.CanvasTexture | null = null;
let material: THREE.MeshStandardMaterial | null = null;
const regions = new Map<string, Region>();
let shelfX = 0;
let shelfY = 0;
let shelfH = 0;
let dirty = false;

const headless = () => typeof document === 'undefined';

function atlas(): CanvasRenderingContext2D | null {
  if (headless()) return null;
  if (!ctx) {
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.name = 'decalAtlas';
  }
  return ctx;
}

function markDirty() {
  if (dirty) return;
  dirty = true;
  queueMicrotask(() => {
    dirty = false;
    if (texture) texture.needsUpdate = true;
  });
}

/** Allocate w × h px and draw into it. */
function alloc(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, x: number, y: number) => void, estAspect: number): Region {
  const hit = regions.get(key);
  if (hit) return hit;
  const c = atlas();
  if (!c) {
    const r = { u0: 0, v0: 0, u1: 1, v1: 1, aspect: estAspect };
    regions.set(key, r);
    return r;
  }
  w = Math.ceil(w);
  h = Math.ceil(h);
  if (shelfX + w + PAD > W) {
    shelfY += shelfH + PAD;
    shelfX = 0;
    shelfH = 0;
  }
  if (shelfY + h + PAD > H) {
    // Atlas full: reuse a blank corner (invisible) rather than failing.
    const r = { u0: 0, v0: 0, u1: 0.0001, v1: 0.0001, aspect: w / h };
    regions.set(key, r);
    return r;
  }
  const x = shelfX + PAD;
  const y = shelfY + PAD;
  shelfX += w + PAD;
  shelfH = Math.max(shelfH, h);
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  draw(c, x, y);
  c.restore();
  markDirty();
  const r = { u0: x / W, u1: (x + w) / W, v1: 1 - y / H, v0: 1 - (y + h) / H, aspect: w / h };
  regions.set(key, r);
  return r;
}

const FONT = '"DIN Alternate", "Bahnschrift", "Arial Narrow", "Roboto Condensed", "DejaVu Sans Condensed", system-ui, sans-serif';

/** Seeded speckle wear (erases tiny flecks so markings read as painted, not printed). */
function wear(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amount: number, seed: number) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  c.save();
  c.globalCompositeOperation = 'destination-out';
  const n = Math.round(w * h * amount * 0.002);
  for (let i = 0; i < n; i++) {
    const r = 0.6 + rnd() * 1.6;
    c.beginPath();
    c.arc(x + rnd() * w, y + rnd() * h, r, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

const ROUND = new Set('ABDOPQR04689&'.split(''));

/** Draw text with stencil bridges cut through closed letterforms. */
function stencilText(c: CanvasRenderingContext2D, str: string, x: number, baseY: number, px: number, color: string, stencil: boolean, spacing = 0.06) {
  c.fillStyle = color;
  c.textBaseline = 'alphabetic';
  let cx = x;
  for (const ch of str) {
    c.fillText(ch, cx, baseY);
    const w = c.measureText(ch).width;
    if (stencil && ROUND.has(ch)) {
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.fillRect(cx + w / 2 - px * 0.035, baseY - px * 0.8, px * 0.07, px * 0.22);
      c.fillRect(cx + w / 2 - px * 0.035, baseY - px * 0.2, px * 0.07, px * 0.22);
      c.restore();
    }
    cx += w + px * spacing;
  }
  return cx - x - px * spacing;
}

function measure(str: string, px: number, weight = 700, spacing = 0.06): number {
  const c = atlas();
  if (!c) return str.length * px * 0.6;
  c.font = `${weight} ${px}px ${FONT}`;
  let w = 0;
  for (const ch of str) w += c.measureText(ch).width + px * spacing;
  return w - px * spacing;
}

export interface TextOpts {
  color?: string;
  stencil?: boolean;
  weight?: number;
  /** Draw on a filled rounded plate of this colour. */
  plate?: string;
  wear?: number;
}

export const decals = {
  /** Manufacturer mark; `mono` draws it single-colour (e.g. '#f2f2ee' on dark paint). */
  logo(id: LiveryId, mono?: string): Region {
    const S = 128;
    return alloc(`logo:${id}:${mono ?? ''}`, S, S, (c, x, y) => {
      drawLogo(c, id, x, y, S, mono);
      wear(c, x, y, S, S, 0.5, id.length * 97 + 3);
    }, 1);
  },
  /** Mark plus wordmark side by side. */
  badge(id: LiveryId, dark = false): Region {
    const L = LIVERIES[id];
    const px = 64;
    const tw = measure(L.word, px, 800, 0.08);
    const h = 96;
    const w = h + 16 + tw + 8;
    return alloc(`badge:${id}:${dark}`, w, h, (c, x, y) => {
      drawLogo(c, id, x, y, h, dark ? '#eceae4' : undefined);
      c.font = `800 ${px}px ${FONT}`;
      stencilText(c, L.word, x + h + 16, y + h / 2 + px * 0.36, px, dark ? '#eceae4' : L.ink, false, 0.08);
      wear(c, x, y, w, h, 0.6, id.length * 31 + 7);
    }, w / h);
  },
  text(str: string, o: TextOpts = {}): Region {
    const px = 56;
    const weight = o.weight ?? 800;
    const tw = measure(str, px, weight);
    const padX = o.plate ? px * 0.35 : 4;
    const h = o.plate ? px * 1.35 : px * 1.05;
    const w = tw + padX * 2;
    const key = `text:${str}:${o.color}:${o.stencil}:${weight}:${o.plate}`;
    return alloc(key, w, h, (c, x, y) => {
      if (o.plate) {
        c.fillStyle = o.plate;
        roundRect(c, x + 1, y + 1, w - 2, h - 2, px * 0.18);
        c.fill();
      }
      c.font = `${weight} ${px}px ${FONT}`;
      stencilText(c, str, x + padX, y + h / 2 + px * 0.36, px, o.color ?? '#202226', !!o.stencil);
      wear(c, x, y, w, h, o.wear ?? 0.5, str.length * 13 + 1);
    }, w / h);
  },
  /** Two-line identification plate: part name and manufacturer code + serial. */
  partPlate(def: PartDef, dark = false): Region {
    const L = liveryFor(def.manufacturer);
    const name = def.name.toUpperCase();
    let hsh = 0;
    for (const ch of def.id) hsh = (Math.imul(hsh, 31) + ch.charCodeAt(0)) >>> 0;
    const serial = `${L.code}-${String(1000 + (hsh % 9000))}`;
    const px1 = 28;
    const px2 = 21;
    const w = Math.max(measure(name, px1, 800), measure(serial, px2, 600)) + 24;
    const h = 68;
    const ink = dark ? '#e8e6e0' : '#25282d';
    return alloc(`plate:${def.id}:${dark}`, w, h, (c, x, y) => {
      c.fillStyle = L.accent;
      c.fillRect(x + 2, y + 5, 7, h - 10);
      c.font = `800 ${px1}px ${FONT}`;
      stencilText(c, name, x + 17, y + 31, px1, ink, false, 0.05);
      c.font = `600 ${px2}px ${FONT}`;
      stencilText(c, serial, x + 17, y + 59, px2, ink, false, 0.08);
      wear(c, x, y, w, h, 0.4, hsh);
    }, w / h);
  },
  /** Diagonal yellow/black band with a thin border. */
  hazard(): Region {
    const w = 512;
    const h = 64;
    return alloc('hazard', w, h, (c, x, y) => {
      c.fillStyle = '#e8b21c';
      c.fillRect(x, y, w, h);
      c.fillStyle = '#17181a';
      for (let i = -2; i < w / 32 + 2; i++) {
        c.beginPath();
        c.moveTo(x + i * 64, y + h);
        c.lineTo(x + i * 64 + 32, y + h);
        c.lineTo(x + i * 64 + 32 + h, y);
        c.lineTo(x + i * 64 + h, y);
        c.closePath();
        c.fill();
      }
      wear(c, x, y, w, h, 1.2, 77);
    }, w / h);
  },
  /** Agency insignia. */
  insignia(): Region {
    return decals.logo('program');
  },
  symbol(kind: 'warn' | 'arrow' | 'target' | 'lift' | 'ground'): Region {
    const S = 128;
    return alloc(`sym:${kind}`, S, S, (c, x, y) => {
      const cx = x + S / 2;
      const cy = y + S / 2;
      c.lineJoin = 'round';
      switch (kind) {
        case 'warn':
          c.fillStyle = '#e8b21c';
          c.strokeStyle = '#17181a';
          c.lineWidth = 9;
          c.beginPath();
          c.moveTo(cx, y + 12);
          c.lineTo(x + S - 10, y + S - 16);
          c.lineTo(x + 10, y + S - 16);
          c.closePath();
          c.fill();
          c.stroke();
          c.fillStyle = '#17181a';
          c.fillRect(cx - 6, y + 46, 12, 40);
          c.fillRect(cx - 6, y + 92, 12, 12);
          break;
        case 'arrow':
          c.fillStyle = '#25282d';
          c.beginPath();
          c.moveTo(cx, y + 8);
          c.lineTo(x + S - 18, cy);
          c.lineTo(cx + 18, cy);
          c.lineTo(cx + 18, y + S - 8);
          c.lineTo(cx - 18, y + S - 8);
          c.lineTo(cx - 18, cy);
          c.lineTo(x + 18, cy);
          c.closePath();
          c.fill();
          break;
        case 'target':
          c.strokeStyle = '#f0efe9';
          c.lineWidth = 8;
          c.beginPath();
          c.arc(cx, cy, S * 0.38, 0, Math.PI * 2);
          c.stroke();
          c.fillStyle = '#f0efe9';
          c.fillRect(cx - 4, y + 6, 8, S - 12);
          c.fillRect(x + 6, cy - 4, S - 12, 8);
          break;
        case 'lift':
          c.fillStyle = '#25282d';
          c.beginPath();
          c.arc(cx, cy, S * 0.42, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#e8b21c';
          c.beginPath();
          c.arc(cx, cy, S * 0.2, 0, Math.PI * 2);
          c.fill();
          break;
        case 'ground':
          c.strokeStyle = '#25282d';
          c.lineWidth = 9;
          c.lineCap = 'round';
          c.beginPath();
          c.moveTo(cx, y + 14);
          c.lineTo(cx, cy);
          c.moveTo(x + 22, cy);
          c.lineTo(x + S - 22, cy);
          c.moveTo(x + 36, cy + 22);
          c.lineTo(x + S - 36, cy + 22);
          c.moveTo(x + 52, cy + 42);
          c.lineTo(x + S - 52, cy + 42);
          c.stroke();
          break;
      }
      wear(c, x, y, S, S, 0.5, kind.length * 7);
    }, 1);
  },
};

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** The one shared decal material (alpha-tested; batches with opaque geometry). */
export function decalMaterial(): THREE.Material {
  if (!material) {
    atlas();
    material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.0, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (texture) material.map = texture;
    material.name = 'decal';
  }
  return material;
}

export function disposeDecals() {
  material?.dispose();
  texture?.dispose();
  material = null;
  texture = null;
  canvas = null;
  ctx = null;
  regions.clear();
  shelfX = shelfY = shelfH = 0;
}

// ---------------------------------------------------------------------------------------------
// Decal geometry

export interface DecalPlacement {
  /** Centre height (part frame, m). */
  y: number;
  /** Angle around +Y; 0 faces +Z, +PI/2 faces +X (lathe convention). */
  phi: number;
  /** Decal height in metres (width follows the region aspect unless `width` is set). */
  height: number;
  width?: number;
  /** Outward offset from the surface (m). Default 2.5 mm. */
  offset?: number;
  /** Rotate the decal 90° so text runs along the part axis (reads bottom-to-top). */
  vertical?: boolean;
}

/** Decal conforming to a surface of revolution r(y). */
export function decalOnLathe(rOf: (y: number) => number, region: Region, p: DecalPlacement): THREE.BufferGeometry {
  const off = p.offset ?? 0.003;
  const along = p.vertical ? (p.width ?? p.height * region.aspect) : p.height;
  const across = p.vertical ? p.height : (p.width ?? p.height * region.aspect);
  const rC = rOf(p.y) + off;
  const angW = across / Math.max(rC, 1e-3);
  const nx = Math.max(2, Math.ceil(angW / 0.04));
  const ny = 2;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let j = 0; j <= ny; j++) {
    const t = j / ny;
    const y = p.y - along / 2 + along * t;
    const r = rOf(y) + off;
    for (let i = 0; i <= nx; i++) {
      const s = i / nx;
      const a = p.phi + (s - 0.5) * angW;
      pos.push(r * Math.sin(a), y, r * Math.cos(a));
      // vertical: text baseline runs up the part (u along +y), so u = t, v = 1 - s
      const uu = p.vertical ? t : s;
      const vv = p.vertical ? 1 - s : t;
      uv.push(region.u0 + (region.u1 - region.u0) * uu, region.v0 + (region.v1 - region.v0) * vv);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat decal in the XY plane facing +Z, centred at the origin. */
export function decalPlane(region: Region, height: number, width?: number): THREE.BufferGeometry {
  const w = width ?? height * region.aspect;
  const g = new THREE.PlaneGeometry(w, height);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, region.u0 + (region.u1 - region.u0) * uv.getX(i), region.v0 + (region.v1 - region.v0) * uv.getY(i));
  return g;
}
