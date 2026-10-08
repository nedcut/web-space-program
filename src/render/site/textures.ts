import * as THREE from 'three';
import { hashString, persistTextures, takeCachedTextures } from '../core/textureCache';

/**
 * Procedural canvas textures for the launch complex. All original artwork, generated at runtime.
 * Tileable textures represent the tile size noted in each doc comment; geometry UVs are in metres / tile.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Soft blotches drawn with wrap-around so the tile stays seamless. */
function blotches(g: CanvasRenderingContext2D, S: number, n: number, r: () => number, rMin: number, rMax: number, col: (r: () => number) => string) {
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, rad = rMin + r() * (rMax - rMin);
    g.fillStyle = col(r);
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      if (x + dx + rad < 0 || x + dx - rad > S || y + dy + rad < 0 || y + dy - rad > S) continue;
      g.beginPath();
      g.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/**
 * Fine grain: n small dark/light specks. Two constant fill colours with per-speck `globalAlpha` instead of a
 * formatted rgba() string per speck: the same image (±1/255) at half the cost — Blink parses every new colour
 * string, and the pad deck alone draws 60,000 specks on a cold load.
 */
function speckle(g: CanvasRenderingContext2D, S: number, n: number, r: () => number, a = 0.12) {
  let current = -1;
  for (let i = 0; i < n; i++) {
    const l = r() < 0.5 ? 50 : 200;
    if (l !== current) { current = l; g.fillStyle = l === 50 ? '#323232' : '#c8c8c8'; }
    g.globalAlpha = a * (0.4 + r());
    g.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  g.globalAlpha = 1;
}

/** Weathered concrete slab, tile 8 m with a joint every 4 m. */
function concreteTextureImpl(seed = 1, base = '#9c9a94', joints = true): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S, S);
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  blotches(g, S, 260, r, 6, 70, (r) => {
    const l = r() < 0.5 ? 70 + r() * 30 : 170 + r() * 40;
    return `rgba(${l},${l - 2},${l - 6},${0.03 + r() * 0.05})`;
  });
  blotches(g, S, 40, r, 10, 40, () => `rgba(60,56,48,${0.04 + r() * 0.05})`);
  speckle(g, S, 9000, r);
  if (joints) {
    g.strokeStyle = 'rgba(35,34,32,0.55)';
    g.lineWidth = 2;
    for (const p of [0, S / 2]) {
      g.beginPath(); g.moveTo(p + 1, 0); g.lineTo(p + 1, S); g.stroke();
      g.beginPath(); g.moveTo(0, p + 1); g.lineTo(S, p + 1); g.stroke();
    }
    // Hairline cracks
    g.strokeStyle = 'rgba(40,38,35,0.25)';
    g.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      let x = r() * S, y = r() * S;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  }
  return tex(c);
}

/** Scorched concrete for the flame trench (tile 8 m): sooted at the top of each tile, washed paler below. */
function sootTextureImpl(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S, S);
  const r = rng(77);
  g.fillStyle = '#77736a';
  g.fillRect(0, 0, S, S);
  blotches(g, S, 260, r, 10, 80, (r) => `rgba(${20 + r() * 25},${18 + r() * 20},${14 + r() * 14},${0.08 + r() * 0.12})`);
  // Vertical soot runs and paler water-washed streaks (the deluge runs down the walls).
  for (let i = 0; i < 140; i++) {
    const x = r() * S, w = 2 + r() * 12, len = S * (0.3 + r() * 0.7);
    const grd = g.createLinearGradient(0, 0, 0, len);
    const dark = r() < 0.7;
    grd.addColorStop(0, dark ? `rgba(16,13,10,${0.12 + r() * 0.2})` : `rgba(190,186,176,${0.06 + r() * 0.08})`);
    grd.addColorStop(1, 'rgba(16,13,10,0)');
    g.fillStyle = grd;
    g.fillRect(x, 0, w, len);
  }
  // Formwork joints every 2 m.
  g.fillStyle = 'rgba(30,28,25,0.35)';
  for (let y = 0; y < S; y += S / 4) g.fillRect(0, y, S, 2);
  speckle(g, S, 6000, r, 0.12);
  return tex(c);
}

/** Bar grating for platforms, walkways and swing-arm decks (tile 2 m). */
function gratingTextureImpl(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S, S);
  const r = rng(29);
  g.fillStyle = '#23272b';
  g.fillRect(0, 0, S, S);
  // Bearing bars every 4 cm, cross rods every 10 cm, a heavier frame every metre.
  for (let x = 0; x < S; x += 10) { g.fillStyle = '#7d858c'; g.fillRect(x, 0, 4, S); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, 0, 1, S); }
  for (let y = 0; y < S; y += 26) { g.fillStyle = '#69717a'; g.fillRect(0, y, S, 3); }
  g.fillStyle = '#596067';
  for (const p of [0, S / 2]) { g.fillRect(p, 0, 10, S); g.fillRect(0, p, S, 10); }
  blotches(g, S, 60, r, 8, 60, (r) => `rgba(${70 + r() * 40},${45 + r() * 20},${25 + r() * 10},${0.05 + r() * 0.08})`);
  speckle(g, S, 3000, r, 0.1);
  return tex(c);
}

/**
 * Launch pad deck markings for a 48 m × 48 m square centred on the pad (u = x, v = z): concrete with a large
 * painted ring, hazard chevrons around the flame hole and a stencilled pad code. Not tiled.
 */
function padDeckTextureImpl(holeHalf: number, trenchHalf: number): THREE.CanvasTexture {
  const S = 2048;
  const M = 48;
  const px = S / M;
  const { c, g } = canvas(S, S);
  const r = rng(5);
  g.fillStyle = '#a19e96';
  g.fillRect(0, 0, S, S);
  blotches(g, S, 900, r, 10, 140, (r) => {
    const l = r() < 0.5 ? 80 + r() * 40 : 170 + r() * 40;
    return `rgba(${l},${l - 2},${l - 6},${0.025 + r() * 0.05})`;
  });
  speckle(g, S, 60000, r, 0.1);
  const cx = S / 2, cy = S / 2;
  // Exhaust scorching radiating from the flame hole (stronger toward the trench side, -z = top).
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const len = (6 + r() * 12) * px * (Math.sin(a) < 0 ? 1.3 : 0.8);
    const grd = g.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    grd.addColorStop(0, `rgba(25,20,16,${0.15 + r() * 0.15})`);
    grd.addColorStop(1, 'rgba(25,20,16,0)');
    g.strokeStyle = grd;
    g.lineWidth = (1 + r() * 3) * px;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); g.stroke();
  }
  const soot = g.createRadialGradient(cx, cy, holeHalf * px, cx, cy, holeHalf * px * 3.2);
  soot.addColorStop(0, 'rgba(18,15,12,0.75)');
  soot.addColorStop(1, 'rgba(18,15,12,0)');
  g.fillStyle = soot;
  g.fillRect(0, 0, S, S);
  // Expansion joints every 6 m.
  g.strokeStyle = 'rgba(40,38,34,0.5)';
  g.lineWidth = 3;
  for (let m = 0; m <= M; m += 6) {
    g.beginPath(); g.moveTo(m * px, 0); g.lineTo(m * px, S); g.stroke();
    g.beginPath(); g.moveTo(0, m * px); g.lineTo(S, m * px); g.stroke();
  }
  // Irregular oily wheel marks and rain-washed iron stains, baked once into the cached deck.
  for (let i = 0; i < 24; i++) {
    const x = (0.12 + r() * 0.76) * S, y = (0.12 + r() * 0.76) * S;
    g.save(); g.translate(x, y); g.rotate(r() * 6.28);
    g.fillStyle = i % 3 ? 'rgba(36,30,23,0.12)' : 'rgba(103,56,28,0.16)';
    g.beginPath(); g.ellipse(0, 0, 8 + r() * 28, 3 + r() * 8, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // Painted rings.
  g.strokeStyle = 'rgba(236,236,230,0.8)';
  g.lineWidth = 0.35 * px;
  g.beginPath(); g.arc(cx, cy, 15.5 * px, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(92,170,230,0.75)';
  g.lineWidth = 0.6 * px;
  g.beginPath(); g.arc(cx, cy, 16.5 * px, 0, Math.PI * 2); g.stroke();
  // Radial ticks every 10°, long ones on the cardinal directions.
  g.strokeStyle = 'rgba(236,236,230,0.7)';
  g.lineWidth = 0.2 * px;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const l0 = (i % 9 === 0 ? 12.5 : 14.2) * px, l1 = 15.3 * px;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * l0, cy + Math.sin(a) * l0); g.lineTo(cx + Math.cos(a) * l1, cy + Math.sin(a) * l1); g.stroke();
  }
  // Hazard chevron band around the flame hole.
  const h0 = holeHalf * px, h1 = (holeHalf + 1.1) * px;
  g.save();
  g.beginPath();
  g.rect(cx - h1, cy - h1, 2 * h1, 2 * h1);
  g.rect(cx + h0, cy - h0, -2 * h0, 2 * h0);
  g.clip('evenodd');
  g.fillStyle = '#d9a72a';
  g.fillRect(cx - h1, cy - h1, 2 * h1, 2 * h1);
  g.fillStyle = '#1a1a1c';
  for (let k = -40; k < 40; k++) {
    const x = cx + k * 0.9 * px;
    g.beginPath();
    g.moveTo(x, cy - h1); g.lineTo(x + 0.45 * px, cy - h1); g.lineTo(x + 0.45 * px + 2 * h1, cy + h1); g.lineTo(x + 2 * h1, cy + h1);
    g.closePath(); g.fill();
  }
  g.restore();
  // Trench edge stripe (the trench runs toward -z, under the deck).
  g.fillStyle = 'rgba(217,167,42,0.75)';
  g.fillRect(cx - (trenchHalf + 0.6) * px, 0, 0.3 * px, cy - h1);
  g.fillRect(cx + (trenchHalf + 0.3) * px, 0, 0.3 * px, cy - h1);
  // Stencilled pad code, readable from the south side.
  g.save();
  g.translate(cx, cy + 19.2 * px);
  g.fillStyle = 'rgba(236,236,230,0.75)';
  g.font = `800 ${Math.round(2.6 * px)}px Inter, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('LC-1  ·  WSP', 0, 0);
  g.restore();
  // Tie-down bolts / anchor plates at the corners of the hole.
  g.fillStyle = 'rgba(60,60,62,0.9)';
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.fillRect(cx + sx * (holeHalf + 2.2) * px - 0.6 * px, cy + sy * (holeHalf + 2.2) * px - 0.6 * px, 1.2 * px, 1.2 * px);
  return tex(c, true, false);
}

/** Two-lane asphalt road: u across the width (0..1), v along (tile 24 m). */
function roadTextureImpl(crawler = false): THREE.CanvasTexture {
  const W = 256, H = 512;
  const { c, g } = canvas(W, H);
  const r = rng(crawler ? 31 : 21);
  if (crawler) {
    // Two concrete tracks with a gravel median.
    g.fillStyle = '#8f8a80';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) {
      const l = 90 + r() * 110;
      g.fillStyle = `rgba(${l},${l - 6},${l - 14},0.5)`;
      g.fillRect(r() * W, r() * H, 1.5, 1.5);
    }
    for (const [x0, x1] of [[0.04, 0.36], [0.64, 0.96]]) {
      g.fillStyle = '#a7a39b';
      g.fillRect(x0 * W, 0, (x1 - x0) * W, H);
      g.fillStyle = 'rgba(40,38,35,0.45)';
      for (let y = 0; y < H; y += H / 4) g.fillRect(x0 * W, y, (x1 - x0) * W, 2);
    }
    speckle(g, W, 3000, r, 0.08);
  } else {
    g.fillStyle = '#3e3f42';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 12000; i++) {
      const l = 30 + r() * 70;
      g.fillStyle = `rgba(${l},${l},${l + 2},0.5)`;
      g.fillRect(r() * W, r() * H, 1, 1);
    }
    // Wheel-track wear
    for (const x of [0.22, 0.34, 0.66, 0.78]) {
      const grd = g.createLinearGradient((x - 0.06) * W, 0, (x + 0.06) * W, 0);
      grd.addColorStop(0, 'rgba(90,90,92,0)');
      grd.addColorStop(0.5, 'rgba(90,90,92,0.18)');
      grd.addColorStop(1, 'rgba(90,90,92,0)');
      g.fillStyle = grd;
      g.fillRect((x - 0.06) * W, 0, 0.12 * W, H);
    }
    g.fillStyle = 'rgba(230,230,224,0.85)';
    g.fillRect(0.04 * W, 0, 0.02 * W, H);
    g.fillRect(0.94 * W, 0, 0.02 * W, H);
    g.fillStyle = 'rgba(224,178,48,0.9)';
    for (let y = 0; y < H; y += H / 4) g.fillRect(0.49 * W, y, 0.02 * W, H / 8);
  }
  return tex(c);
}

/** Ribbed steel cladding, tile 4 m (u) × 8 m (v), with horizontal sheet seams and grime streaks. */
/**
 * Runway surface tile: grooved asphalt, white edge stripes and a dashed white centreline. u spans the full
 * 60 m width (0..1), one tile = 60 m along the runway (30 m dash + 30 m gap).
 */
function runwayTextureImpl(): THREE.CanvasTexture {
  const W = 512, H = 512;
  const { c, g } = canvas(W, H);
  const r = rng(77);
  g.fillStyle = '#35363a';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 26000; i++) {
    const l = 28 + r() * 62;
    g.fillStyle = `rgba(${l},${l},${l + 3},0.45)`;
    g.fillRect(r() * W, r() * H, 1, 1);
  }
  // Rubber deposits along the main-gear tracks, lighter concrete-patch blotches.
  for (const x of [0.38, 0.62]) {
    const grd = g.createLinearGradient((x - 0.08) * W, 0, (x + 0.08) * W, 0);
    grd.addColorStop(0, 'rgba(15,15,16,0)');
    grd.addColorStop(0.5, 'rgba(15,15,16,0.28)');
    grd.addColorStop(1, 'rgba(15,15,16,0)');
    g.fillStyle = grd;
    g.fillRect((x - 0.08) * W, 0, 0.16 * W, H);
  }
  blotches(g, W, 10, r, 10, 40, () => 'rgba(120,120,118,0.06)');
  // Transverse grooves.
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 1);
  g.fillStyle = 'rgba(236,236,230,0.9)';
  g.fillRect(0.015 * W, 0, 0.015 * W, H); // edge stripes (0.9 m)
  g.fillRect(0.97 * W, 0, 0.015 * W, H);
  g.fillRect(0.4925 * W, H * 0.25, 0.015 * W, H * 0.5); // centreline dash
  return tex(c);
}

/**
 * Runway end markings for one 60 m x 120 m end zone (u across, v from the end inward): piano-key threshold
 * bars, a two-digit heading designator, and touchdown-zone bars. Text reads upright from the approach
 * (canvas top = far end, v = 1).
 */
function runwayEndTextureImpl(designator: string): THREE.CanvasTexture {
  const W = 512, H = 1024;
  const { c, g } = canvas(W, H);
  g.clearRect(0, 0, W, H);
  const white = 'rgba(238,238,232,0.92)';
  g.fillStyle = white;
  // Canvas y=0 is v=1 (far end); the runway end (v=0) is at the bottom of the canvas.
  const vy = (v: number) => H * (1 - v);
  // Threshold piano keys: 8 bars per side of the centreline, 0.03..0.17 of the zone length.
  const bars = 16;
  for (let i = 0; i < bars; i++) {
    const side = i < bars / 2 ? 0 : 1;
    const k = i % (bars / 2);
    const x0 = side === 0 ? 0.06 + k * 0.053 : 0.535 + k * 0.053;
    g.fillRect(x0 * W, vy(0.17), 0.03 * W, vy(0.03) - vy(0.17));
  }
  // Designator digits (block style), upright when seen from the approach.
  g.save();
  g.translate(W / 2, (vy(0.2) + vy(0.38)) / 2);
  g.font = `bold ${Math.round(H * 0.17)}px "Arial Narrow", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(designator, 0, 0);
  g.restore();
  // Touchdown-zone and aiming-point bars.
  for (const [v0, v1, w] of [[0.48, 0.56, 0.05], [0.66, 0.84, 0.09], [0.92, 0.98, 0.05]] as const) {
    for (const x of [0.3, 0.7 - w]) g.fillRect(x * W, vy(v1), w * W, vy(v0) - vy(v1));
  }
  return tex(c, true, false);
}

function claddingTextureImpl(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 512);
  g.fillStyle = '#c3c1b4';
  g.fillRect(0, 0, 256, 512);
  // Trapezoidal ribs every 0.5 m: a lit face, a shadowed face and a flat pan.
  for (let x = 0; x < 256; x += 32) {
    const grd = g.createLinearGradient(x, 0, x + 32, 0);
    grd.addColorStop(0, '#7f857c');
    grd.addColorStop(0.12, '#e2dfd3');
    grd.addColorStop(0.24, '#cfccbf');
    grd.addColorStop(0.7, '#b9b7aa');
    grd.addColorStop(0.86, '#9fa197');
    grd.addColorStop(1, '#6f756d');
    g.fillStyle = grd;
    g.fillRect(x, 0, 32, 512);
  }
  // Sheet end laps (8 m sheets, one per tile) with their fastener rows.
  g.fillStyle = 'rgba(30,32,36,0.55)';
  g.fillRect(0, 0, 256, 4);
  g.fillStyle = 'rgba(40,42,46,0.6)';
  for (let x = 6; x < 256; x += 16) { g.fillRect(x, 10, 2, 2); g.fillRect(x, 500, 2, 2); }
  const r = rng(13);
  // Rain-washed grime from fasteners and laps, heavier toward the bottom of each sheet.
  for (let i = 0; i < 220; i++) {
    const x = r() * 256, y = r() * 512, h = 30 + r() * 160;
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, `rgba(48,46,42,${0.04 + r() * 0.1})`);
    grd.addColorStop(1, 'rgba(48,46,42,0)');
    g.fillStyle = grd;
    g.fillRect(x, y, 2 + r() * 10, h);
  }
  const base = g.createLinearGradient(0, 380, 0, 512);
  base.addColorStop(0, 'rgba(70,64,52,0)');
  base.addColorStop(1, 'rgba(70,64,52,0.22)');
  g.fillStyle = base;
  g.fillRect(0, 380, 256, 132);
  return tex(c);
}

/** Giant hangar door: tall panels with horizontal ribs; u across the full door, v up the full height. */
function vabDoorTextureImpl(): THREE.CanvasTexture {
  const W = 512, H = 1024;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#a3abb4';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 8) {
    g.fillStyle = y % 16 === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
    g.fillRect(0, y, W, 4);
  }
  g.strokeStyle = 'rgba(45,50,58,0.85)';
  g.lineWidth = 4;
  const cols = 4;
  for (let i = 1; i < cols; i++) { g.beginPath(); g.moveTo((i * W) / cols, 0); g.lineTo((i * W) / cols, H); g.stroke(); }
  for (let y = H / 14; y < H; y += H / 14) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, H - 10);
  const r = rng(17);
  for (let i = 0; i < 80; i++) {
    g.fillStyle = `rgba(50,52,56,${r() * 0.06})`;
    g.fillRect(r() * W, r() * H, 3 + r() * 10, 30 + r() * 140);
  }
  // Hazard band at the bottom.
  for (let x = -64; x < W; x += 32) {
    g.fillStyle = '#e0b230';
    g.beginPath(); g.moveTo(x, H); g.lineTo(x + 16, H); g.lineTo(x + 40, H - 18); g.lineTo(x + 24, H - 18); g.closePath(); g.fill();
  }
  return tex(c, true, false);
}

/** Large painted "WSP" agency wordmark with an orbit swoosh (transparent background). */
function logoTextureImpl(): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const { c, g } = canvas(W, H);
  g.clearRect(0, 0, W, H);
  // Orbit ellipse behind the letters.
  g.save();
  g.translate(W / 2, H * 0.47);
  g.rotate(-0.18);
  g.strokeStyle = 'rgba(92,200,255,0.95)';
  g.lineWidth = 22;
  g.beginPath(); g.ellipse(0, 0, W * 0.46, H * 0.27, 0, Math.PI * 0.08, Math.PI * 1.92); g.stroke();
  g.fillStyle = '#f2f4f7';
  g.beginPath(); g.arc(W * 0.46 * Math.cos(Math.PI * 0.04), -H * 0.27 * Math.sin(Math.PI * 0.04) + 4, 26, 0, Math.PI * 2); g.fill();
  g.restore();
  g.fillStyle = '#f2f4f7';
  g.font = '900 290px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('WSP', W / 2, H * 0.5);
  g.font = '700 52px Inter, system-ui, sans-serif';
  g.fillStyle = 'rgba(242,244,247,0.9)';
  g.fillText('WEB  SPACE  PROGRAM', W / 2, H * 0.9);
  return tex(c, true, false);
}

/** Original agency flag: deep blue field, white diagonal band and a four-point star (transparent edges). */
function flagTextureImpl(): THREE.CanvasTexture {
  const W = 1024, H = 640;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#173f73';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e9edf2';
  g.beginPath(); g.moveTo(0, H * 0.78); g.lineTo(W * 0.55, 0); g.lineTo(W * 0.72, 0); g.lineTo(0, H); g.closePath(); g.fill();
  g.fillStyle = '#d9a72a';
  g.beginPath(); g.moveTo(W * 0.62, H); g.lineTo(W, H * 0.42); g.lineTo(W, H * 0.52); g.lineTo(W * 0.72, H); g.closePath(); g.fill();
  // Four-point star
  const sx = W * 0.74, sy = H * 0.3, R1 = H * 0.17, R2 = H * 0.045;
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? R1 : R2;
    g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 12;
  g.strokeRect(6, 6, W - 12, H - 12);
  return tex(c, true, false);
}

/** Office façade: window bands on precast concrete, tile 12 m × 4 m (one storey). */
function windowsTextureImpl(): THREE.CanvasTexture {
  const W = 512, H = 256;
  const { c, g } = canvas(W, H);
  const r = rng(41);
  g.fillStyle = '#c9c6bd';
  g.fillRect(0, 0, W, H);
  blotches(g, W, 40, r, 6, 30, (r) => `rgba(${120 + r() * 60},${118 + r() * 60},${110 + r() * 60},${0.05 + r() * 0.06})`);
  speckle(g, W, 2500, r, 0.08);
  // Precast panel joints (every 3 m) and the floor-slab joint.
  g.fillStyle = 'rgba(70,68,62,0.55)';
  for (let x = 0; x < W; x += W / 4) g.fillRect(x, 0, 2, H);
  g.fillRect(0, H * 0.92, W, 3);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = (i / n) * W + 8, w = W / n - 16;
    // Recessed reveal (shadowed head and jamb), then the glazing.
    g.fillStyle = '#5c5a55';
    g.fillRect(x - 3, H * 0.3 - 4, w + 6, H * 0.45 + 6);
    const grd = g.createLinearGradient(0, H * 0.3, 0, H * 0.75);
    const lit = r() < 0.3;
    grd.addColorStop(0, lit ? '#7891ad' : '#33465d');
    grd.addColorStop(1, lit ? '#4d5f75' : '#18212c');
    g.fillStyle = grd;
    g.fillRect(x, H * 0.3, w, H * 0.45);
    // Sky reflection band and blinds in some panes.
    g.fillStyle = 'rgba(205,220,236,0.2)';
    g.fillRect(x, H * 0.3, w * 0.35, H * 0.45);
    if (r() < 0.4) { g.fillStyle = 'rgba(214,206,186,0.55)'; g.fillRect(x, H * 0.3, w, H * (0.08 + r() * 0.2)); }
    g.fillStyle = '#55595f';
    g.fillRect(x + w / 2 - 2, H * 0.3, 4, H * 0.45);
    // Sill with a dirt run below it.
    g.fillStyle = '#e1ded6';
    g.fillRect(x - 5, H * 0.75, w + 10, 5);
    const run = g.createLinearGradient(0, H * 0.75 + 5, 0, H);
    run.addColorStop(0, 'rgba(60,58,52,0.25)');
    run.addColorStop(1, 'rgba(60,58,52,0)');
    g.fillStyle = run;
    for (let k = 0; k < 5; k++) g.fillRect(x + r() * w, H * 0.75 + 5, 2 + r() * 6, H * 0.25);
  }
  g.fillStyle = 'rgba(60,60,60,0.35)';
  g.fillRect(0, H - 6, W, 6);
  return tex(c);
}

// ---------------------------------------------------------------------------------------------
// Caching: canvases are reused within a session (hub → flight) and persisted across sessions in
// IndexedDB, keyed by arguments plus a hash of the drawing code (see render/core/textureCache).
// ---------------------------------------------------------------------------------------------
const memory = new Map<string, { canvas: HTMLCanvasElement; srgb: boolean; repeat: boolean }>();
let helpersHash = '';
function cachedSite<A extends unknown[]>(name: string, make: (...args: A) => THREE.CanvasTexture): (...args: A) => THREE.CanvasTexture {
  return (...args: A) => {
    if (typeof document === 'undefined') return make(...args);
    helpersHash ||= hashString([rng, canvas, tex, blotches, speckle].map(String).join('\n'));
    const group = `site:${name}:${JSON.stringify(args)}`;
    const id = `${group}:${helpersHash}:${hashString(String(make))}`;
    let entry = memory.get(id);
    if (!entry) {
      const stored = takeCachedTextures(id)?.[0];
      if (stored) memory.set(id, (entry = { canvas: stored.canvas, srgb: stored.srgb, repeat: stored.slot === 'repeat' }));
    }
    if (entry) return tex(entry.canvas, entry.srgb, entry.repeat);
    const t = make(...args);
    const fresh = { canvas: t.image as HTMLCanvasElement, srgb: t.colorSpace === THREE.SRGBColorSpace, repeat: t.wrapS === THREE.RepeatWrapping };
    memory.set(id, fresh);
    persistTextures(group, id, [{ slot: fresh.repeat ? 'repeat' : 'clamp', srgb: fresh.srgb, canvas: fresh.canvas }]);
    return t;
  };
}

export const concreteTexture = cachedSite('concreteTexture', concreteTextureImpl);
export const sootTexture = cachedSite('sootTexture', sootTextureImpl);
export const padDeckTexture = cachedSite('padDeckTexture', padDeckTextureImpl);
export const roadTexture = cachedSite('roadTexture', roadTextureImpl);
export const runwayTexture = cachedSite('runwayTexture', runwayTextureImpl);
export const runwayEndTexture = cachedSite('runwayEndTexture', runwayEndTextureImpl);
export const claddingTexture = cachedSite('claddingTexture', claddingTextureImpl);
export const vabDoorTexture = cachedSite('vabDoorTexture', vabDoorTextureImpl);
export const logoTexture = cachedSite('logoTexture', logoTextureImpl);
export const flagTexture = cachedSite('flagTexture', flagTextureImpl);
export const windowsTexture = cachedSite('windowsTexture', windowsTextureImpl);
export const gratingTexture = cachedSite('gratingTexture', gratingTextureImpl);

/** Only occupied window panes emit; walls and mullions stay dark. Cached with all site canvases. */
function windowLightTextureImpl(): THREE.CanvasTexture {
  const { c, g } = canvas(512, 256);
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256);
  for (const i of [0, 2, 3, 5]) {
    const x = i * 512 / 6 + 8, w = 512 / 6 - 16;
    g.fillStyle = i === 2 ? '#a4b8bd' : '#efd5a0';
    g.fillRect(x, 256 * 0.3, w, 256 * 0.45);
    g.fillStyle = '#000'; g.fillRect(x + w / 2 - 2, 256 * 0.3, 4, 256 * 0.45);
  }
  return tex(c);
}
export const windowLightTexture = cachedSite('windowLightTexture', windowLightTextureImpl);

/** Compact original facility signage atlas; opaque panels batch into one draw. */
function facilitySignsTextureImpl(): THREE.CanvasTexture {
  const { c, g } = canvas(1024, 512);
  const labels = [['WSP', 'FLIGHT OPERATIONS'], ['WSP', 'SYSTEMS WORKSHOP'], ['RANGE 01', 'LAUNCH CONTROL'], ['COASTAL', 'LAUNCH COMPLEX']];
  for (let i = 0; i < labels.length; i++) {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
    g.fillStyle = '#183a43'; g.fillRect(x, y, 512, 256);
    g.fillStyle = '#d8b56c'; g.fillRect(x + 24, y + 26, 8, 204);
    g.fillStyle = '#eee8d5'; g.font = '700 68px sans-serif'; g.fillText(labels[i][0], x + 52, y + 113);
    g.font = '500 28px sans-serif'; g.fillText(labels[i][1], x + 52, y + 174);
  }
  return tex(c, true, false);
}
export const facilitySignsTexture = cachedSite('facilitySignsTexture', facilitySignsTextureImpl);
