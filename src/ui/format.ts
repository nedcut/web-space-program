/** Display formatting helpers (shared by HUD, map, editor). */

const J2000_MS = Date.UTC(2000, 0, 1, 12);

export function formatDate(ut: number): string {
  const d = new Date(J2000_MS + ut * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function formatDistance(m: number): string {
  if (Number.isNaN(m)) return '—';
  if (!Number.isFinite(m)) return m > 0 ? '∞' : '−∞';
  const a = Math.abs(m);
  if (a < 1e4) return `${m.toFixed(0)} m`;
  if (a < 1e7) return `${(m / 1e3).toFixed(1)} km`;
  if (a < 1e10) return `${(m / 1e6).toFixed(2)} Mm`;
  if (a < 1e13) return `${(m / 1.495978707e11).toFixed(3)} AU`;
  return `${(m / 9.4607e15).toFixed(2)} ly`;
}

export function formatSpeed(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const a = Math.abs(ms);
  return a < 1e4 ? `${ms.toFixed(1)} m/s` : `${(ms / 1e3).toFixed(2)} km/s`;
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec)) return '—';
  const neg = sec < 0;
  let s = Math.abs(sec);
  const y = Math.floor(s / 31557600); s -= y * 31557600;
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts: string[] = [];
  if (y) parts.push(`${y}y`);
  if (d || y) parts.push(`${d}d`);
  if (h || d || y) parts.push(`${h}h`);
  if (m || h || d || y) parts.push(`${m}m`);
  parts.push(`${s.toFixed(y || d ? 0 : 1)}s`);
  return (neg ? 'T-' : '') + parts.slice(0, 3).join(' ');
}

export function formatMass(kg: number): string {
  return kg < 1e4 ? `${kg.toFixed(0)} kg` : `${(kg / 1e3).toFixed(2)} t`;
}
