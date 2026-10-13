/**
 * Compact planner readouts. Chips hold the two most significant units ("86d 7h", "22m 37s") so they keep one width
 * and never wrap; the full value (date, all units) goes in the chip's tooltip.
 */
import { formatDate, formatDuration } from '../../ui/format';
import type { StageDeltaV } from '../../sim/vessel/staging';

const UNITS: [string, number][] = [['y', 31557600], ['d', 86400], ['h', 3600], ['m', 60]];

/** Two most significant units; tenths of a second under one minute. */
export function shortDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  const neg = sec < 0;
  let s = Math.abs(sec);
  if (s < 60) return `${neg ? '−' : ''}${s.toFixed(1)}s`;
  const parts: string[] = [];
  for (const [u, n] of UNITS) {
    if (parts.length === 2) break;
    const q = Math.floor(s / n);
    if (q || parts.length) { parts.push(`${q}${u}`); s -= q * n; }
  }
  if (parts.length < 2) parts.push(`${Math.floor(s)}s`);
  return (neg ? '−' : '') + parts.join(' ');
}

/** "T−22m 37s" before an event, "T+5.0s" after. */
export function shortCountdown(sec: number): string {
  return sec >= 0 ? `T−${shortDuration(sec)}` : `T+${shortDuration(-sec)}`;
}

/** Whole metres per second; transfer estimates are not meaningful below that. */
export function dvText(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v)} m/s` : '—';
}

/** Calendar date only ("2030-10-14"); `formatDate` has the full timestamp for tooltips. */
export function shortDate(ut: number): string {
  return formatDate(ut).slice(0, 10);
}

/** Full-precision tooltip line for a moment: "2030-10-14 19:49:20 UTC (in 86d 7h 49m)". */
export function whenTitle(ut: number, now: number): string {
  return `${formatDate(ut)} (in ${formatDuration(ut - now)})`;
}

/** Vacuum Δv per remaining stage in firing order (highest stage number first), empty stages dropped. */
export function budgetStages(stages: readonly StageDeltaV[]): { stage: number; dv: number }[] {
  return stages.filter(s => s.dvVac > 0.5).sort((a, b) => b.stage - a.stage).map(s => ({ stage: s.stage, dv: s.dvVac }));
}
