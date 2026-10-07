/**
 * Procedural PBR texture recipes for parts. DOM-free (runs in a worker): each recipe returns raw
 * RGBA8 images — albedo (sRGB), tangent-space normal and a packed ORM map (R = ambient occlusion,
 * G = roughness, B = metalness; three.js reads exactly those channels for aoMap/roughnessMap/
 * metalnessMap, so one texture serves all three).
 *
 * Each texture represents one tile of the size documented on the recipe; part geometry UVs are in
 * metres / tile. Bump TEX_VERSION whenever any recipe output changes so IndexedDB caches refresh.
 */
import { Field, cavityAO, clamp01, fbm, fract, gridDist, grayImg, hash2, mix, normalImg, ormImg, rgbImg, ridge, ridged, smooth, sstep, vnoise, voronoi, type Img } from './noise';

export const TEX_VERSION = 12;

export type Channel = 'albedo' | 'normal' | 'orm' | 'emissive';
export type TexData = Partial<Record<Channel, Img>>;

export interface Recipe {
  /** Square size in pixels (power of two). */
  size: number;
  channels: Channel[];
  /** Placeholder metalness (0..1) used before the real texture arrives. */
  metal?: number;
  /** Placeholder albedo (linear-ish 0..1 RGB) used before the real texture arrives. */
  avg?: [number, number, number];
  make: () => TexData;
}

// ---------------------------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------------------------

/**
 * Painted aluminium skin (white thermal paint family). One tile = 2 m × 2 m (materials repeat it at 0.5, so
 * part UVs stay metres): 4 × 2 staggered panels of 0.5 m × 1 m, each with its own paint tone, warmth and gloss,
 * 8 mm seams with rolled lips, rivet rows, doubler plates, one screwed access hatch, stencil data blocks,
 * grime running down from the seams and a few chips. Seams, tones and gloss are sized to read at 10–20 m.
 */
function panel(): TexData {
  const N = 1024;
  const M = 2; // metres per tile
  const cell = (u: number, v: number) => {
    const col = Math.floor(u * 4) & 3;
    const vv = v + (col & 1 ? 0.25 : 0);
    const row = Math.floor(vv * 2) & 1;
    const fu = fract(u * 4);
    const fv = fract(vv * 2);
    const du = Math.min(fu, 1 - fu) * 0.5; // metres to the vertical seam
    const dv = Math.min(fv, 1 - fv) * 1; // metres to the horizontal seam
    return { col, row, fu, fv, du, dv, id: col * 2 + row };
  };
  const rivets = (c: ReturnType<typeof cell>) => {
    const r = 0.0035;
    // rows 16 mm either side of each seam, 45 mm pitch
    const along = (d: number, t: number, len: number) => {
      const dd = Math.abs(d - 0.016);
      if (dd > r) return 0;
      const q = (fract((t * len) / 0.045) - 0.5) * 0.045;
      const dist = Math.hypot(dd, q);
      return dist < r ? smooth(1 - dist / r) : 0;
    };
    return Math.max(along(c.du, c.fv, 1), along(c.dv, c.fu, 0.5));
  };
  const hatch = (c: ReturnType<typeof cell>) => {
    if (c.id !== 5) return 1;
    const x = (c.fu - 0.5) * 0.5;
    const y = (c.fv - 0.32) * 1;
    const qx = Math.abs(x) - 0.09 + 0.014;
    const qy = Math.abs(y) - 0.11 + 0.014;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.014;
  };
  const doubler = (c: ReturnType<typeof cell>) => {
    if (hash2(c.id, 3, 801) < 0.62) return 1;
    const x = Math.min(c.fu, 1 - c.fu) * 0.5;
    const y = Math.min(c.fv, 1 - c.fv) * 1;
    return Math.min(x - 0.045, y - 0.06); // >0 inside the plate
  };
  const height = new Field(N, N).fill((u, v) => {
    const c = cell(u, v);
    const sd = Math.min(c.du, c.dv);
    let h = 0.05 * Math.pow(Math.sin(Math.PI * c.fu) * Math.sin(Math.PI * c.fv), 0.4); // oil-canning
    h -= 0.7 * ridge(sd, 0.0045);
    h += 0.12 * ridge(Math.abs(sd - 0.008), 0.003);
    h += 0.3 * rivets(c);
    const d = doubler(c);
    if (d > 0 && d < 1) h += 0.06 * sstep(0, 0.004, d);
    const hd = hatch(c);
    h -= 0.5 * ridge(Math.abs(hd), 0.0025);
    if (hd < 0) h += 0.025;
    if (c.id === 5)
      for (const [px, py] of [[-0.07, -0.09], [0.07, -0.09], [-0.07, 0.09], [0.07, 0.09], [0, -0.09], [0, 0.09]]) {
        const dd = Math.hypot((c.fu - 0.5) * 0.5 - px, (c.fv - 0.32) - py);
        if (dd < 0.005) h += 0.35 * smooth(1 - dd / 0.005) - (dd < 0.0015 ? 0.3 : 0);
      }
    h += 0.01 * fbm(u, v, 48, 3, 3) * M;
    return h;
  });
  const grime = new Field(N, N);
  const chip = new Field(N, N);
  const tone = new Field(N, N);
  const albedo = rgbImg(N, N, (u, v, out, x, y) => {
    const c = cell(u, v);
    const i = y * N + x;
    const sd = Math.min(c.du, c.dv);
    const pt = hash2(c.id, 7, 811);
    const warm = (hash2(c.id, 9, 812) - 0.5) * 0.035;
    tone.data[i] = pt;
    // streaks fall from the seam at the top of each panel (+v is up the part)
    const below = (1 - c.fv) * 1;
    const fall = Math.exp(-below * 2.4);
    const streak = sstep(0.52, 0.86, fbm(u, v, 96, 3, 11, 3)) * (0.25 + 0.75 * fall);
    const smudge = sstep(0.5, 0.82, fbm(u, v, 6, 4, 5));
    const g = clamp01(streak * 0.6 + smudge * 0.35);
    grime.data[i] = g;
    const ch = sd < 0.012 && fbm(u, v, 96, 3, 91) > 0.8 ? 1 : 0;
    chip.data[i] = ch;
    if (ch) {
      out[0] = 0.6; out[1] = 0.61; out[2] = 0.63;
      return;
    }
    let k = (0.85 + 0.15 * pt) * (1 - 0.035 * fbm(u, v, 8, 3, 7));
    k *= 1 - 0.13 * g;
    k *= 1 - 0.42 * ridge(sd, 0.006) - 0.08 * ridge(sd, 0.02);
    const hd = hatch(c);
    k *= 1 - 0.3 * ridge(Math.abs(hd), 0.004);
    // stencilled data blocks: rows of small ink marks on some panels
    if (hash2(c.id, 5, 813) > 0.5) {
      // fine stencil lines: 9 mm caps, 3.5 mm stroke rhythm, word gaps
      const lx = c.fu * 0.5 - 0.06;
      const ly = (c.fv - 0.88) * 1;
      if (lx > 0 && lx < 0.16 && ly > -0.05 && ly < 0.0) {
        const rowI = Math.floor(-ly / 0.016);
        const fy = fract(-ly / 0.016);
        const ci = Math.floor(lx / 0.0085);
        const fx = fract(lx / 0.0085);
        const len = rowI === 0 ? 17 : rowI === 1 ? 11 : 14;
        const glyph = hash2(ci + rowI * 23, c.id, 814);
        const stroke = (fx < 0.28 || (glyph > 0.45 && fx > 0.52 && fx < 0.78) || (glyph > 0.7 && (fy < 0.42 || fy > 0.82))) && fy > 0.3;
        if (ci < len && glyph > 0.12 && stroke) k *= 0.5;
      }
    }
    out[0] = k * (1 + warm);
    out[1] = k * (0.997 + warm * 0.2);
    out[2] = k * (0.985 - warm) - 0.025 * g;
  });
  const ao = cavityAO(height, 3, 1.6, 0.62);
  const rough = new Field(N, N).fill((u, v, x, y) => {
    const i = y * N + x;
    return 0.24 + 0.2 * tone.data[i] + 0.06 * fbm(u, v, 16, 4, 21) + 0.25 * grime.data[i] - 0.1 * chip.data[i];
  });
  return { albedo, normal: normalImg(height, 2.6), orm: ormImg(ao, rough, chip, N, N) };
}

/**
 * Spray-on foam insulation (orange). 1.5 m tile: soft lumps, spray "rind" ridges, sparse pores and
 * UV-tanned colour variation from pale orange to deep rust.
 */
function foam(): TexData {
  const N = 512;
  const height = new Field(N, N).fill((u, v) => {
    const big = fbm(u, v, 3, 4, 41);
    const mid = fbm(u, v, 10, 3, 42);
    const rind = ridged(u, v, 6, 3, 43, 9);
    const p = voronoi(u, v, 90, 44);
    const pore = p.d1 < 0.16 && hash2(p.id & 255, (p.id >> 8) & 255, 45) > 0.72 ? -0.25 * smooth(1 - p.d1 / 0.16) : 0;
    return big * 0.25 + mid * 0.16 + rind * 0.08 + pore * 0.6;
  });
  const albedo = rgbImg(N, N, (u, v, out) => {
    const a = fbm(u, v, 3, 4, 51);
    const b = fbm(u, v, 14, 3, 52);
    const tan = sstep(0.35, 0.8, a * 0.7 + b * 0.3);
    const light = sstep(0.55, 0.85, fbm(u, v, 6, 3, 53));
    // overlapping spray passes: soft horizontal bands with wavy edges, alternately richer and paler
    const pass = Math.sin((v * 5 + 0.7 * fbm(u, v, 3, 3, 55)) * Math.PI * 2) * 0.5 + 0.5;
    const band = sstep(0.35, 0.75, pass) * (0.025 + 0.035 * fbm(u, v, 2, 2, 56));
    const r = mix(0.9, 0.68, tan) + 0.03 * light - band * 0.6;
    const g = mix(0.45, 0.3, tan) + 0.03 * light - band;
    const bl = mix(0.16, 0.1, tan) + 0.02 * light - band * 0.4;
    const speck = fbm(u, v, 64, 2, 54) > 0.78 ? 0.8 : 1;
    out[0] = r * speck;
    out[1] = g * speck;
    out[2] = bl * speck;
  });
  const ao = cavityAO(height, 4, 2.2, 0.55);
  const rough = new Field(N, N).fill((u, v) => 0.62 + 0.22 * fbm(u, v, 20, 3, 61) + 0.1 * fbm(u, v, 3, 3, 62));
  return { albedo, normal: normalImg(height, 3.6), orm: ormImg(ao, rough, 0, N, N) };
}

/** Brushed stainless: circumferential grain, a weld seam per metre with heat tint. Tile 1 m. */
function brushed(): TexData {
  const N = 512;
  const height = new Field(N, N).fill((u, v) => {
    const grain = vnoise(u * 4, v * 320, 4, 320, 71) * 0.06 + vnoise(u * 2, v * 900, 2, 900, 74) * 0.03;
    const dw = Math.abs(v - 0.5);
    const seam = 0.45 * ridge(dw, 0.004) - 0.25 * ridge(dw, 0.012);
    return grain + seam + fbm(u, v, 3, 3, 75) * 0.2;
  });
  const albedo = rgbImg(N, N, (u, v, out) => {
    const dw = Math.abs(v - 0.5);
    const heat = ridge(dw, 0.05);
    const k = 0.93 - 0.07 * fbm(u, v, 8, 3, 77);
    // temper colours: straw near the seam, then faint blue
    const straw = ridge(dw, 0.018);
    const blue = Math.max(0, heat - straw);
    out[0] = k * (1 - 0.1 * blue) - 0.04 * heat;
    out[1] = k * (1 - 0.12 * straw) - 0.04 * heat;
    out[2] = k * (1 - 0.35 * straw + 0.05 * blue) - 0.03 * heat;
  });
  const rough = new Field(N, N).fill((u, v) => 0.2 + 0.07 * vnoise(u * 3, v * 200, 3, 200, 72) + 0.1 * fbm(u, v, 6, 3, 73) + 0.15 * ridge(Math.abs(v - 0.5), 0.012));
  const ao = cavityAO(height, 2, 3, 0.7);
  return { albedo, normal: normalImg(height, 2.2), orm: ormImg(ao, rough, 1, N, N) };
}

/** Machined / anodised small-hardware metal: soft smudges and fine lathe rings. Tile 0.5 m. */
function metal(): TexData {
  const N = 256;
  const height = new Field(N, N).fill((u, v) => 0.03 * vnoise(u * 2, v * 180, 2, 180, 201) + 0.06 * fbm(u, v, 8, 3, 202));
  const albedo = rgbImg(N, N, (u, v, out) => {
    const k = 0.95 - 0.04 * fbm(u, v, 6, 4, 203) - 0.03 * sstep(0.6, 0.9, fbm(u, v, 16, 3, 204));
    out[0] = out[1] = out[2] = k;
  });
  const rough = new Field(N, N).fill((u, v) => 0.34 + 0.08 * fbm(u, v, 6, 4, 205) + 0.06 * sstep(0.55, 0.85, fbm(u, v, 18, 3, 206)));
  return { albedo, normal: normalImg(height, 2), orm: ormImg(1, rough, 1, N, N) };
}

/**
 * Multi-layer insulation foil: elongated crinkle facets with sharp creases, a finer second crinkle,
 * and taped seams every 0.5 m. Tile 1 m (anisotropic: creases run mostly around the part).
 */
function foil(): TexData {
  const N = 512;
  const albedoF = new Field(N, N);
  const roughF = new Field(N, N);
  const aoF = new Field(N, N);
  // Continuous folded film: the former random facet planes jumped at cell boundaries,
  // producing black fractures instead of thin crinkled foil under a sharp reflection.
  const height = new Field(N, N).fill((u, v, x, y) => {
    const warp = fbm(u, v, 4, 3, 301);
    const fold = ridged(u + warp * 0.08, v, 12, 3, 311, 2.4);
    const broad = fbm(u, v, 5, 3, 312, 2);
    const tapeD = gridDist(v, 2);
    const tape = 1 - sstep(0.009, 0.016, tapeD);
    const i = y * N + x;
    albedoF.data[i] = 0.96 - fold * 0.045 - tape * 0.025;
    roughF.data[i] = 0.19 + 0.10 * fold + tape * 0.08;
    aoF.data[i] = 0.97 - fold * 0.06;
    return (broad * 0.8 + fold * 0.45) * (1 - tape * 0.8) + tape * 0.2;
  });
  return { albedo: grayImg(albedoF), normal: normalImg(height, 18), orm: ormImg(aoF, roughF, 1, N, N) };
}

/** Quilted beta-cloth blanket: stitched pillows 5 × 5 per metre with faint handling dirt. */
function quilt(): TexData {
  const N = 512;
  const K = 5;
  const height = new Field(N, N).fill((u, v) => {
    const fu = fract(u * K);
    const fv = fract(v * K);
    const pillow = Math.pow(Math.max(0, Math.sin(Math.PI * fu) * Math.sin(Math.PI * fv)), 0.35);
    const stitch = (gridDist(u, K) < 0.002 || gridDist(v, K) < 0.002) && fract((u + v) * 160) < 0.5 ? -0.15 : 0;
    return pillow + fbm(u, v, 30, 3, 111) * 0.2 + stitch;
  });
  const albedo = rgbImg(N, N, (u, v, out) => {
    const seam = Math.max(ridge(gridDist(u, K), 0.006), ridge(gridDist(v, K), 0.006));
    const dirt = sstep(0.55, 0.85, fbm(u, v, 6, 4, 113));
    const k = 0.95 - seam * 0.15 - dirt * 0.08;
    out[0] = k;
    out[1] = k * 0.99;
    out[2] = k * 0.965;
  });
  const ao = cavityAO(height, 6, 1.6, 0.5);
  const rough = new Field(N, N).fill((u, v) => 0.72 + 0.16 * fbm(u, v, 14, 3, 115));
  return { albedo, normal: normalImg(height, 3), orm: ormImg(ao, rough, 0, N, N) };
}

/** Ceramic heat tiles (staggered squares, char and tone variation). Tile 0.5 m, 8 × 8 tiles. */
function tiles(): TexData {
  const N = 512;
  const K = 8;
  const tileId = (u: number, v: number) => {
    const row = Math.floor(v * K);
    const uo = u * K + (row % 2) * 0.5;
    return { row, col: Math.floor(uo) % K, fu: fract(uo), fv: fract(v * K) };
  };
  const height = new Field(N, N).fill((u, v) => {
    const t = tileId(u, v);
    const gap = Math.min(t.fu, 1 - t.fu, t.fv, 1 - t.fv);
    return sstep(0.0, 0.06, gap) * (0.85 + 0.15 * hash2(t.col, t.row & 255, 3)) + 0.1 * fbm(u, v, 32, 3, 121);
  });
  const albedo = rgbImg(N, N, (u, v, out) => {
    const t = tileId(u, v);
    const gap = Math.min(t.fu, 1 - t.fu, t.fv, 1 - t.fv);
    const tone = 0.75 + 0.25 * hash2(t.col, t.row & 255, 7);
    const ch = fbm(u, v, 6, 4, 125);
    const base = (gap < 0.03 ? 0.3 : 1) * 0.16 * tone * (0.75 + 0.5 * ch);
    out[0] = base * 1.2;
    out[1] = base;
    out[2] = base * 0.88;
  });
  const ao = cavityAO(height, 3, 2.5, 0.4);
  const rough = new Field(N, N).fill((u, v) => 0.8 + 0.15 * fbm(u, v, 16, 3, 127));
  return { albedo, normal: normalImg(height, 4), orm: ormImg(ao, rough, 0, N, N) };
}

/** Honeycomb-filled ablator: ~2 cm hex cells, charred resin and tan filler. Tile 0.5 m. */
function ablator(): TexData {
  const N = 512;
  const K = 24;
  const hex = (u: number, v: number) => {
    // periodic hex lattice (K columns, K rows with sqrt(3) aspect folded into the cell scale)
    const y = v * K;
    const row = Math.floor(y);
    const x = u * K + (row % 2) * 0.5;
    const fx = fract(x) - 0.5;
    const fy = fract(y) - 0.5;
    const d = Math.max(Math.abs(fx) * 0.866 + Math.abs(fy) * 0.5, Math.abs(fy));
    return { d, id: (Math.floor(x) % K) * 64 + (row % K) };
  };
  const height = new Field(N, N).fill((u, v) => {
    const h = hex(u, v);
    return -0.25 * sstep(0.36, 0.5, h.d) + 0.12 * fbm(u, v, 20, 3, 401) - 0.04 * hash2(h.id & 255, h.id >> 8, 402);
  });
  const albedo = rgbImg(N, N, (u, v, out) => {
    const h = hex(u, v);
    const cellTone = hash2(h.id & 255, h.id >> 8, 403);
    const charF = sstep(0.35, 0.7, fbm(u, v, 4, 4, 404) * 0.7 + cellTone * 0.3);
    const wall = sstep(0.4, 0.48, h.d);
    const r = mix(0.22, 0.065, charF) * (1 - 0.35 * wall);
    out[0] = r;
    out[1] = r * 0.92;
    out[2] = r * 0.86;
  });
  const ao = cavityAO(height, 2, 3, 0.5);
  const rough = new Field(N, N).fill((u, v) => 0.82 + 0.15 * fbm(u, v, 12, 3, 405));
  return { albedo, normal: normalImg(height, 4), orm: ormImg(ao, rough, 0, N, N) };
}

/** Regenerative-cooling tubes for engine bells: 8 tubes across one tile (u), axial along v. */
function tubes(): TexData {
  const N = 256;
  const T = 8;
  const height = new Field(N, N).fill((u, v) => {
    const x = fract(u * T) * 2 - 1;
    return Math.sqrt(Math.max(0, 1 - x * x)) * 0.38 + 0.012 * fbm(u, v, 8, 2, 131);
  });
  const albedo = rgbImg(N, N, (u, v, out) => {
    const f = fract(u * T);
    const crease = ridge(Math.min(f, 1 - f), 0.12);
    const n = fbm(u, v, 6, 4, 133);
    const heat = sstep(0.5, 1, v) * 0.25; // darker oxidised copper toward the throat (top)
    const k = (0.86 + 0.24 * n - crease * 0.35) * (1 - heat);
    out[0] = 0.88 * k;
    out[1] = 0.58 * k;
    out[2] = 0.44 * k;
  });
  const ao = cavityAO(height, 3, 1.6, 0.4);
  const rough = new Field(N, N).fill((u, v) => 0.28 + 0.22 * fbm(u, v, 10, 3, 135) + 0.2 * ridge(Math.min(fract(u * T), 1 - fract(u * T)), 0.1));
  return { albedo, normal: normalImg(height, 5), orm: ormImg(ao, rough, 1, N, N) };
}

/** Radiatively cooled nozzle extension: temper colours (straw at the hot top, v = 1, to blue-grey). */
function nozzleExt(): TexData {
  const N = 256;
  const albedo = rgbImg(N, N, (u, v, out) => {
    const t = v + (fbm(u, v, 4, 3, 141) - 0.5) * 0.15;
    const c1 = [0.52, 0.46, 0.36];
    const c2 = [0.39, 0.36, 0.42];
    const c3 = [0.36, 0.39, 0.43];
    const a = sstep(0.55, 0.95, t);
    const b = sstep(0.2, 0.55, t);
    for (let i = 0; i < 3; i++) out[i] = mix(c3[i], mix(c2[i], c1[i], a), b) * (0.92 + 0.08 * fbm(u, v, 24, 2, 146));
  });
  const height = new Field(N, N).fill((u, v) => 0.12 * ridge(Math.abs(fract(v * 4) - 0.5), 0.02) + 0.04 * fbm(u, v, 20, 2, 143));
  const rough = new Field(N, N).fill((u, v) => 0.43 + 0.16 * fbm(u, v, 8, 3, 145));
  return { albedo, normal: normalImg(height, 4), orm: ormImg(1, rough, 1, N, N) };
}

/** Monocrystalline solar cells, 4 × 4 per tile (0.5 m), chamfered corners, busbars and fingers. */
function solar(): TexData {
  const N = 512;
  const K = 4;
  const cell = (u: number, v: number) => {
    const fu = fract(u * K);
    const fv = fract(v * K);
    const gap = Math.min(fu, 1 - fu, fv, 1 - fv);
    const corner = Math.min(fu, 1 - fu) + Math.min(fv, 1 - fv) < 0.12;
    return { fu, fv, gap, corner };
  };
  const metalF = new Field(N, N);
  const roughF = new Field(N, N);
  const albedo = rgbImg(N, N, (u, v, out, x, y) => {
    const c = cell(u, v);
    const i = y * N + x;
    metalF.data[i] = 0;
    roughF.data[i] = 0.12;
    if (c.gap < 0.016 || c.corner) {
      out[0] = 0.8;
      out[1] = 0.82;
      out[2] = 0.85;
      roughF.data[i] = 0.55;
      return;
    }
    if (Math.abs(c.fu - 0.33) < 0.006 || Math.abs(c.fu - 0.66) < 0.006) {
      out[0] = 0.78;
      out[1] = 0.79;
      out[2] = 0.8;
      metalF.data[i] = 1;
      roughF.data[i] = 0.3;
      return;
    }
    const n = fbm(u, v, 20, 2, 151) * 0.04;
    const tone = hash2(Math.floor(u * K), Math.floor(v * K), 152) * 0.025;
    if (fract(c.fv * 40) < 0.05) {
      out[0] = 0.2;
      out[1] = 0.24;
      out[2] = 0.34;
      metalF.data[i] = 0.6;
      return;
    }
    out[0] = 0.03 + n + tone;
    out[1] = 0.055 + n + tone;
    out[2] = 0.17 + n * 2 + tone * 2;
  });
  const height = new Field(N, N).fill((u, v) => sstep(0, 0.03, cell(u, v).gap));
  return { albedo, normal: normalImg(height, 2), orm: ormImg(1, roughF, metalF, N, N) };
}

/** Corrugated shingles (dark) for the single-seat capsule. Tile 0.5 m. */
function shingle(): TexData {
  const N = 512;
  const height = new Field(N, N).fill((u, v) => {
    const rib = Math.abs(Math.sin(u * Math.PI * 10)) ** 0.6;
    const step = 1 - fract(v * 4); // overlapping shingles step down toward +v... edge at the top of each row
    return rib * 0.35 + step * 0.9 + 0.04 * fbm(u, v, 30, 2, 161);
  });
  const albedo = rgbImg(N, N, (u, v, out) => {
    const k = 0.85 + 0.15 * fbm(u, v, 10, 3, 163) - 0.25 * ridge(fract(v * 4), 0.04) - 0.12 * sstep(0.6, 0.9, fbm(u, v, 30, 2, 164));
    out[0] = out[1] = out[2] = k;
  });
  const ao = cavityAO(height, 3, 1.4, 0.5);
  const rough = new Field(N, N).fill((u, v) => 0.34 + 0.25 * fbm(u, v, 12, 3, 165));
  return { albedo, normal: normalImg(height, 3), orm: ormImg(ao, rough, 1, N, N) };
}

/** Yellow/black diagonal hazard stripes with worn edges. Tile 0.25 m along u. */
function hazard(): TexData {
  const N = 256;
  const metalF = new Field(N, N);
  const albedo = rgbImg(N, N, (u, v, out, x, y) => {
    const s = fract((u + v) * 4);
    const wear = fbm(u, v, 16, 3, 171);
    const k = 0.85 + 0.15 * wear;
    if (wear > 0.73) {
      out[0] = out[1] = out[2] = 0.55;
      metalF.data[y * N + x] = 1;
      return;
    }
    if (s < 0.5) {
      out[0] = 0.95 * k;
      out[1] = 0.7 * k;
      out[2] = 0.06 * k;
    } else out[0] = out[1] = out[2] = 0.045;
  });
  const rough = new Field(N, N).fill((u, v) => 0.5 + 0.25 * fbm(u, v, 16, 3, 172));
  return { albedo, orm: ormImg(1, rough, metalF, N, N) };
}

/** 2 × 2 twill carbon weave. Tile 0.1 m. */
function carbon(): TexData {
  const N = 256;
  const K = 16;
  const over = (u: number, v: number) => ((Math.floor(u * K) + Math.floor(v * K)) >> 1) % 2 === 0;
  const height = new Field(N, N).fill((u, v) => (over(u, v) ? Math.sin(Math.PI * fract(u * K)) : Math.sin(Math.PI * fract(v * K))) * 0.6);
  const albedo = rgbImg(N, N, (u, v, out) => {
    const k = over(u, v) ? 0.15 + 0.05 * Math.sin(Math.PI * fract(u * K)) : 0.09 + 0.04 * Math.sin(Math.PI * fract(v * K));
    out[0] = out[1] = out[2] = k;
  });
  const rough = new Field(N, N).fill((u, v) => (over(u, v) ? 0.32 : 0.42));
  return { albedo, normal: normalImg(height, 2), orm: ormImg(1, rough, 0.15, N, N) };
}

/** Parachute gores: 12 gores around u, two colours with reinforcing tapes. */
function canopy(scheme: 'orange' | 'red' | 'white'): TexData {
  const colors: Record<string, [number[], number[]]> = {
    orange: [[0.95, 0.42, 0.08], [0.94, 0.93, 0.9]],
    red: [[0.75, 0.1, 0.08], [0.94, 0.93, 0.9]],
    white: [[0.94, 0.93, 0.9], [0.7, 0.72, 0.75]],
  };
  const [a, b] = colors[scheme];
  const albedo = rgbImg(256, 256, (u, v, out) => {
    const g = Math.floor(u * 12) % 2 === 0 ? a : b;
    const fu = fract(u * 12);
    const tape = Math.min(fu, 1 - fu) < 0.03 || fract(v * 6) < 0.03;
    const k = (tape ? 0.8 : 1) * (0.94 + 0.06 * fbm(u, v, 8, 2, 181));
    out[0] = g[0] * k;
    out[1] = g[1] * k;
    out[2] = g[2] * k;
  });
  return { albedo };
}

/** Ion grid perforation (hex holes) as albedo + emissive. Tile = grid diameter. */
function ionGrid(): TexData {
  const N = 256;
  const K = 18;
  const hole = (u: number, v: number) => {
    const y = v * K;
    const row = Math.floor(y);
    const x = u * K + (row % 2) * 0.5;
    return Math.hypot(fract(x) - 0.5, fract(y) - 0.5) < 0.32;
  };
  const albedo = rgbImg(N, N, (u, v, out) => {
    const k = hole(u, v) ? 0.02 : 0.36;
    out[0] = out[1] = k;
    out[2] = k * 1.05;
  });
  const emissive = rgbImg(N, N, (u, v, out) => {
    const fall = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2);
    const on = hole(u, v) ? 1 : 0;
    out[0] = 0.4 * fall * on;
    out[1] = 0.75 * fall * on;
    out[2] = fall * on;
  });
  return { albedo, emissive };
}

/** Smooth painted composite: faint orange peel, one seam, subtle tone. Tile 1 m. */
function smoothPaint(): TexData {
  const N = 256;
  const height = new Field(N, N).fill((u, v) => fbm(u, v, 24, 3, 181) * 0.25 - 0.5 * ridge(Math.abs(v - 0.5), 0.005));
  const albedo = rgbImg(N, N, (u, v, out) => {
    const k = 0.965 - 0.045 * fbm(u, v, 6, 3, 183) - 0.05 * sstep(0.6, 0.9, fbm(u, v, 20, 2, 184));
    out[0] = out[1] = out[2] = k;
  });
  const rough = new Field(N, N).fill((u, v) => 0.34 + 0.14 * fbm(u, v, 10, 3, 185));
  return { albedo, normal: normalImg(height, 2.5), orm: ormImg(1, rough, 0, N, N) };
}

/** Radiator / louvre panel: fine horizontal slats. Tile 0.25 m. */
function louvre(): TexData {
  const N = 256;
  const height = new Field(N, N).fill((u, v) => fract(v * 16) * 0.8);
  const albedo = grayImg(new Field(N, N).fill((u, v) => 0.9 - 0.3 * ridge(fract(v * 16), 0.08) - 0.05 * fbm(u, v, 8, 2, 191)));
  const ao = cavityAO(height, 3, 1.5, 0.5);
  return { albedo, normal: normalImg(height, 2.5), orm: ormImg(ao, 0.32, 0.8, N, N) };
}

/**
 * Scorched engine-bay metal: dark heat-stained steel with soot streaks running toward the nozzle
 * (-v) and blued temper patches. Tile 1 m.
 */
function scorch(): TexData {
  const N = 512;
  const sootF = new Field(N, N).fill((u, v) => {
    const streak = fbm(u, v, 40, 3, 501, 2);
    const blot = fbm(u, v, 4, 4, 502);
    return clamp01(sstep(0.35, 0.75, streak * 0.6 + blot * 0.5) * (0.6 + 0.4 * (1 - v)));
  });
  const albedo = rgbImg(N, N, (u, v, out, x, y) => {
    const s = sootF.data[y * N + x];
    const temper = sstep(0.55, 0.8, fbm(u, v, 3, 3, 503));
    const base = 0.42 - 0.05 * fbm(u, v, 12, 3, 504);
    out[0] = mix(base * (1 - 0.15 * temper), 0.05, s);
    out[1] = mix(base * (1 - 0.1 * temper), 0.045, s);
    out[2] = mix(base * (1 + 0.25 * temper), 0.04, s);
  });
  const height = new Field(N, N).fill((u, v, x, y) => 0.05 * fbm(u, v, 24, 3, 505) + 0.08 * sootF.data[y * N + x]);
  const rough = new Field(N, N).fill((u, v, x, y) => 0.42 + 0.45 * sootF.data[y * N + x]);
  const metalF = new Field(N, N).fill((u, v, x, y) => 0.85 * (1 - sootF.data[y * N + x]));
  return { albedo, normal: normalImg(height, 2), orm: ormImg(1, rough, metalF, N, N) };
}

/** Tyre tread: chevron lugs across u, circumferential along v. Tile 0.25 m. */
function tread(): TexData {
  const N = 256;
  const height = new Field(N, N).fill((u, v) => {
    // lugs repeat around the tyre (u); chevrons point across the tread (v), shoulders at v = 0 / 1
    const c = fract(u * 4 + Math.abs(v - 0.5) * 0.9);
    const lug = c < 0.55 ? 1 : 0;
    const groove = Math.abs(v - 0.5) < 0.03 ? 0.5 : 1;
    const shoulder = sstep(0.0, 0.18, Math.min(v, 1 - v));
    return lug * groove * shoulder + (1 - shoulder) * 0.6 + 0.05 * fbm(u, v, 20, 2, 601);
  });
  const ao = cavityAO(height, 3, 1.2, 0.35);
  const albedo = grayImg(new Field(N, N).fill((u, v) => 0.85 + 0.15 * fbm(u, v, 10, 2, 602)));
  const rough = new Field(N, N).fill((u, v) => 0.8 + 0.15 * fbm(u, v, 16, 2, 603));
  return { albedo, normal: normalImg(height, 3), orm: ormImg(ao, rough, 0, N, N) };
}

/** Anti-slip deck / tread plate (diamond pattern), for ladders, walkways and girders. Tile 0.25 m. */
function treadPlate(): TexData {
  const N = 256;
  const K = 12;
  const height = new Field(N, N).fill((u, v) => {
    const row = Math.floor(v * K);
    const fu = fract(u * K + (row % 2) * 0.5) - 0.5;
    const fv = fract(v * K) - 0.5;
    const a = (row % 2 === 0 ? 1 : -1) * 0.7;
    const x = fu * Math.cos(a) - fv * Math.sin(a);
    const y = fu * Math.sin(a) + fv * Math.cos(a);
    const d = Math.hypot(x * 3.2, y);
    return 0.6 * sstep(0.32, 0.22, d) + 0.04 * fbm(u, v, 16, 2, 701);
  });
  const albedo = grayImg(new Field(N, N).fill((u, v) => 0.85 - 0.12 * fbm(u, v, 6, 3, 702)));
  const rough = new Field(N, N).fill((u, v) => 0.38 + 0.2 * fbm(u, v, 8, 3, 703));
  return { albedo, normal: normalImg(height, 3), orm: ormImg(1, rough, 1, N, N) };
}

// ---------------------------------------------------------------------------------------------

export const RECIPES: Record<string, Recipe> = {
  panel: { size: 1024, channels: ['albedo', 'normal', 'orm'], make: panel },
  foam: { avg: [0.8, 0.4, 0.15], size: 512, channels: ['albedo', 'normal', 'orm'], make: foam },
  brushed: { size: 512, channels: ['albedo', 'normal', 'orm'], metal: 1, make: brushed },
  metal: { size: 256, channels: ['albedo', 'normal', 'orm'], metal: 1, make: metal },
  foil: { size: 512, channels: ['albedo', 'normal', 'orm'], metal: 1, make: foil },
  quilt: { size: 512, channels: ['albedo', 'normal', 'orm'], make: quilt },
  tiles: { avg: [0.17, 0.14, 0.12], size: 512, channels: ['albedo', 'normal', 'orm'], make: tiles },
  ablator: { avg: [0.25, 0.2, 0.16], size: 512, channels: ['albedo', 'normal', 'orm'], make: ablator },
  tubes: { avg: [0.8, 0.52, 0.4], size: 256, channels: ['albedo', 'normal', 'orm'], metal: 1, make: tubes },
  nozzleExt: { avg: [0.4, 0.34, 0.4], size: 256, channels: ['albedo', 'normal', 'orm'], metal: 1, make: nozzleExt },
  solar: { avg: [0.06, 0.08, 0.22], size: 512, channels: ['albedo', 'normal', 'orm'], make: solar },
  shingle: { size: 512, channels: ['albedo', 'normal', 'orm'], metal: 1, make: shingle },
  hazard: { avg: [0.5, 0.38, 0.05], size: 256, channels: ['albedo', 'orm'], make: hazard },
  carbon: { avg: [0.12, 0.12, 0.12], size: 256, channels: ['albedo', 'normal', 'orm'], make: carbon },
  'canopy-orange': { avg: [0.95, 0.65, 0.5], size: 256, channels: ['albedo'], make: () => canopy('orange') },
  'canopy-red': { avg: [0.85, 0.5, 0.5], size: 256, channels: ['albedo'], make: () => canopy('red') },
  'canopy-white': { size: 256, channels: ['albedo'], make: () => canopy('white') },
  ionGrid: { avg: [0.25, 0.25, 0.27], size: 256, channels: ['albedo', 'emissive'], make: ionGrid },
  smooth: { size: 256, channels: ['albedo', 'normal', 'orm'], make: smoothPaint },
  louvre: { size: 256, channels: ['albedo', 'normal', 'orm'], metal: 0.8, make: louvre },
  scorch: { avg: [0.2, 0.19, 0.19], size: 512, channels: ['albedo', 'normal', 'orm'], metal: 0.6, make: scorch },
  tread: { size: 256, channels: ['albedo', 'normal', 'orm'], make: tread },
  treadPlate: { size: 256, channels: ['albedo', 'normal', 'orm'], metal: 1, make: treadPlate },
};

/** Generate one recipe's images. */
export function generate(key: string): TexData {
  const r = RECIPES[key];
  if (!r) throw new Error(`unknown texture recipe ${key}`);
  return r.make();
}
