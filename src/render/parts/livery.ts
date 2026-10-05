/**
 * Manufacturer liveries: accent colours and procedurally drawn logo marks for the fictional part
 * makers (see MANUFACTURERS in src/data/parts/builders.ts and docs/ART.md). All marks are original
 * geometric designs drawn with Canvas 2D paths — no external images or fonts beyond system sans.
 */

export type LiveryId = 'halvorsen' | 'kettle' | 'tessellate' | 'greywater' | 'northlight' | 'brightfield' | 'lumen' | 'aldercrest' | 'tread' | 'bedrock' | 'program';

export interface Livery {
  id: LiveryId;
  /** Short stencil code used in part numbers. */
  code: string;
  /** Wordmark text (upper case). */
  word: string;
  /** Primary accent (CSS hex). */
  accent: string;
  /** Secondary colour for marks on light paint. */
  ink: string;
}

export const LIVERIES: Record<LiveryId, Livery> = {
  halvorsen: { id: 'halvorsen', code: 'HPW', word: 'HALVORSEN', accent: '#d9601e', ink: '#2a2d33' },
  kettle: { id: 'kettle', code: 'K&F', word: 'KETTLE & FUSE', accent: '#b3261e', ink: '#2a2d33' },
  tessellate: { id: 'tessellate', code: 'TSS', word: 'TESSELLATE', accent: '#1c7a78', ink: '#2a2d33' },
  greywater: { id: 'greywater', code: 'GWA', word: 'GREYWATER', accent: '#1f5aa6', ink: '#2a2d33' },
  northlight: { id: 'northlight', code: 'NCS', word: 'NORTHLIGHT', accent: '#c8962c', ink: '#1d3f78' },
  brightfield: { id: 'brightfield', code: 'BFA', word: 'BRIGHTFIELD', accent: '#e0a91e', ink: '#2a2d33' },
  lumen: { id: 'lumen', code: 'L&V', word: 'LUMEN & VOLT', accent: '#2b8a5e', ink: '#2a2d33' },
  aldercrest: { id: 'aldercrest', code: 'ACA', word: 'ALDERCREST', accent: '#8e2b3a', ink: '#2a2d33' },
  tread: { id: 'tread', code: 'T&T', word: 'TARMAC & TREAD', accent: '#e8b622', ink: '#202226' },
  bedrock: { id: 'bedrock', code: 'BPE', word: 'BEDROCK', accent: '#9a5a2c', ink: '#2a2d33' },
  program: { id: 'program', code: 'WSP', word: 'WEB SPACE PROGRAM', accent: '#2f8fd6', ink: '#1a2230' },
};

const BY_NAME: Record<string, LiveryId> = {
  'Halvorsen Propulsion Works': 'halvorsen',
  'Kettle & Fuse Pyrotechnics': 'kettle',
  'Tessellate Structures': 'tessellate',
  'Greywater Aerodynamics': 'greywater',
  'Northlight Crew Systems': 'northlight',
  'Brightfield Autonomics': 'brightfield',
  'Lumen & Volt': 'lumen',
  'Aldercrest Aeroengines': 'aldercrest',
  'Tarmac & Tread Undercarriage Co.': 'tread',
  'Bedrock Process Engineering': 'bedrock',
};

export function liveryFor(manufacturer: string | undefined): Livery {
  return LIVERIES[(manufacturer && BY_NAME[manufacturer]) || 'program'];
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draw a manufacturer mark centred in a size × size box at (x, y).
 * `mono` draws everything in a single colour (for dark surfaces).
 */
export function drawLogo(ctx: Ctx, id: LiveryId, x: number, y: number, size: number, mono?: string) {
  const L = LIVERIES[id];
  const a = mono ?? L.accent;
  const k = mono ?? L.ink;
  const s = size;
  const cx = x + s / 2;
  const cy = y + s / 2;
  const R = s * 0.46;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const ring = (w: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(cx, cy, R - w / 2, 0, Math.PI * 2);
    ctx.stroke();
  };
  switch (id) {
    case 'halvorsen': {
      // nozzle bell with three flame chevrons
      ring(s * 0.06, k);
      ctx.fillStyle = k;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.08, cy - s * 0.3);
      ctx.lineTo(cx + s * 0.08, cy - s * 0.3);
      ctx.quadraticCurveTo(cx + s * 0.1, cy - s * 0.05, cx + s * 0.22, cy + s * 0.02);
      ctx.lineTo(cx - s * 0.22, cy + s * 0.02);
      ctx.quadraticCurveTo(cx - s * 0.1, cy - s * 0.05, cx - s * 0.08, cy - s * 0.3);
      ctx.fill();
      ctx.strokeStyle = a;
      ctx.lineWidth = s * 0.055;
      for (let i = 0; i < 3; i++) {
        const yy = cy + s * (0.1 + i * 0.09);
        const w = s * (0.17 - i * 0.045);
        ctx.beginPath();
        ctx.moveTo(cx - w, yy);
        ctx.lineTo(cx, yy + s * 0.05);
        ctx.lineTo(cx + w, yy);
        ctx.stroke();
      }
      break;
    }
    case 'kettle': {
      // round charge with a fuse and a four-point spark
      ctx.fillStyle = k;
      ctx.beginPath();
      ctx.arc(cx - s * 0.06, cy + s * 0.08, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = k;
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.1, cy - s * 0.1);
      ctx.quadraticCurveTo(cx + s * 0.16, cy - s * 0.24, cx + s * 0.24, cy - s * 0.24);
      ctx.stroke();
      ctx.fillStyle = a;
      star(ctx, cx + s * 0.3, cy - s * 0.3, s * 0.16, s * 0.045, 4);
      ctx.fillStyle = mono ? 'rgba(0,0,0,0)' : '#ffffff';
      if (!mono) {
        ctx.beginPath();
        ctx.arc(cx - s * 0.14, cy + s * 0.0, s * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'tessellate': {
      // isometric cube built from three rhombi (two tones)
      const h = s * 0.4;
      const pts = (ang: number) => [cx + Math.cos(ang) * h, cy + Math.sin(ang) * h] as const;
      const top = [pts(-Math.PI / 2), pts(-Math.PI / 6), [cx, cy] as const, pts((-5 * Math.PI) / 6)];
      const left = [pts((-5 * Math.PI) / 6), [cx, cy] as const, pts(Math.PI / 2), pts((5 * Math.PI) / 6)];
      const right = [[cx, cy] as const, pts(-Math.PI / 6), pts(Math.PI / 6), pts(Math.PI / 2)];
      const poly = (p: readonly (readonly [number, number])[], col: string) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(p[0][0], p[0][1]);
        for (const q of p.slice(1)) ctx.lineTo(q[0], q[1]);
        ctx.closePath();
        ctx.fill();
      };
      poly(top, a);
      poly(left, k);
      poly(right, mono ? a : '#5f6670');
      if (mono) {
        ctx.strokeStyle = 'rgba(0,0,0,0)';
      }
      break;
    }
    case 'greywater': {
      // swept delta over three wave lines
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.36, cy - s * 0.02);
      ctx.lineTo(cx + s * 0.38, cy - s * 0.3);
      ctx.lineTo(cx + s * 0.1, cy - s * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = k;
      ctx.lineWidth = s * 0.05;
      for (let i = 0; i < 3; i++) {
        const yy = cy + s * (0.1 + i * 0.1);
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.36, yy);
        for (let j = 0; j <= 4; j++) ctx.quadraticCurveTo(cx - s * 0.36 + s * 0.18 * (j - 0.5), yy + (j % 2 ? -1 : 1) * s * 0.05, cx - s * 0.36 + s * 0.18 * j, yy);
        ctx.stroke();
      }
      break;
    }
    case 'northlight': {
      ring(s * 0.05, a);
      ctx.fillStyle = k;
      star(ctx, cx, cy, s * 0.36, s * 0.07, 4);
      ctx.fillStyle = a;
      star(ctx, cx, cy, s * 0.2, s * 0.05, 4, Math.PI / 4);
      break;
    }
    case 'brightfield': {
      // rising half-sun with rays over a horizon bar
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.12, s * 0.2, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = a;
      ctx.lineWidth = s * 0.045;
      for (let i = 0; i < 7; i++) {
        const ang = Math.PI + ((i + 0.5) / 7) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * s * 0.26, cy + s * 0.12 + Math.sin(ang) * s * 0.26);
        ctx.lineTo(cx + Math.cos(ang) * s * 0.38, cy + s * 0.12 + Math.sin(ang) * s * 0.38);
        ctx.stroke();
      }
      ctx.fillStyle = k;
      ctx.fillRect(cx - s * 0.4, cy + s * 0.16, s * 0.8, s * 0.07);
      break;
    }
    case 'lumen': {
      ring(s * 0.07, a);
      ctx.fillStyle = k;
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.06, cy - s * 0.32);
      ctx.lineTo(cx - s * 0.16, cy + s * 0.04);
      ctx.lineTo(cx - s * 0.01, cy + s * 0.04);
      ctx.lineTo(cx - s * 0.07, cy + s * 0.32);
      ctx.lineTo(cx + s * 0.17, cy - s * 0.06);
      ctx.lineTo(cx + s * 0.02, cy - s * 0.06);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'aldercrest': {
      // crest: two swept wings around a leaf
      ctx.fillStyle = a;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * s * 0.05, cy + s * 0.1);
        ctx.quadraticCurveTo(cx + side * s * 0.25, cy - s * 0.02, cx + side * s * 0.42, cy - s * 0.22);
        ctx.quadraticCurveTo(cx + side * s * 0.3, cy + s * 0.12, cx + side * s * 0.05, cy + s * 0.22);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = k;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.34);
      ctx.quadraticCurveTo(cx + s * 0.13, cy - s * 0.05, cx, cy + s * 0.3);
      ctx.quadraticCurveTo(cx - s * 0.13, cy - s * 0.05, cx, cy - s * 0.34);
      ctx.fill();
      break;
    }
    case 'tread': {
      ring(s * 0.1, k);
      ctx.fillStyle = a;
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        ctx.save();
        ctx.translate(cx + Math.cos(ang) * (R - s * 0.05), cy + Math.sin(ang) * (R - s * 0.05));
        ctx.rotate(ang);
        ctx.fillRect(-s * 0.025, -s * 0.035, s * 0.05, s * 0.07);
        ctx.restore();
      }
      ctx.fillStyle = k;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bedrock': {
      // mountain with strata bands
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.4, cy + s * 0.3);
      ctx.lineTo(cx - s * 0.08, cy - s * 0.32);
      ctx.lineTo(cx + s * 0.08, cy - s * 0.1);
      ctx.lineTo(cx + s * 0.18, cy - s * 0.22);
      ctx.lineTo(cx + s * 0.4, cy + s * 0.3);
      ctx.closePath();
      ctx.clip();
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? k : a;
        ctx.fillRect(cx - s * 0.5, cy - s * 0.35 + i * s * 0.11, s, s * 0.11);
      }
      ctx.restore();
      break;
    }
    case 'program': {
      // agency insignia: planet disc, orbit ellipse, star
      ctx.fillStyle = mono ?? '#1a2230';
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mono ? 'rgba(0,0,0,0)' : a;
      if (!mono) {
        ctx.beginPath();
        ctx.arc(cx - s * 0.06, cy + s * 0.06, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = mono ? '#000' : '#ffffff';
      ctx.lineWidth = s * 0.035;
      ctx.beginPath();
      ctx.ellipse(cx, cy, s * 0.38, s * 0.15, -0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = mono ? '#000' : '#ffffff';
      star(ctx, cx + s * 0.24, cy - s * 0.22, s * 0.09, s * 0.03, 4);
      break;
    }
  }
  ctx.restore();
}

function star(ctx: Ctx, x: number, y: number, ro: number, ri: number, n: number, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = rot - Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}
