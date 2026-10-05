/**
 * Allocation-free per-frame CPU profiler for the flight loop and HUD.
 *
 * Sections accumulate main-thread milliseconds for the current frame; `endFrame` rolls them into
 * a ring buffer so an overlay (or `window.__perf`) can report averages, percentiles and a frame-time
 * graph. Cost when disabled is one boolean check per call. DOM-free so it can be unit tested.
 */
export const PROFILE_SECTIONS = [
  'input', 'sim', 'vessels', 'fx', 'planets', 'map', 'render', 'telemetry', 'audio', 'navball', 'hud',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

const N = PROFILE_SECTIONS.length;
const INDEX = Object.fromEntries(PROFILE_SECTIONS.map((s, i) => [s, i])) as Record<ProfileSection, number>;
/** Frames retained for statistics/graph (about 4 s at 60 fps). */
export const PROFILE_HISTORY = 240;

export interface ProfileSummary {
  frames: number;
  fps: number;
  /** requestAnimationFrame interval statistics (ms). */
  frameMs: { avg: number; p50: number; p95: number; p99: number; max: number };
  /** Main-thread CPU for the flight frame plus navball and HUD work (ms). */
  cpuMs: { avg: number; p95: number; max: number };
  /** Average ms per frame for each section. */
  sections: Record<ProfileSection, number>;
  /** Frames longer than 25 ms / 50 ms in the window. */
  hitches25: number;
  hitches50: number;
}

const now: () => number = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

export class FrameProfiler {
  enabled = false;
  private current = new Float64Array(N);
  private history = new Float64Array(PROFILE_HISTORY * N);
  /** rAF-to-rAF interval for each retained frame. */
  readonly intervals = new Float64Array(PROFILE_HISTORY);
  private cpu = new Float64Array(PROFILE_HISTORY);
  private head = 0;
  private count = 0;
  /** Frames completed since the last reset (not limited to the retained history). */
  totalFrames = 0;
  private frameStart = 0;
  private lastFrame = -1;
  private scratch = new Float64Array(PROFILE_HISTORY);

  now(): number { return this.enabled ? now() : 0; }

  /** Add the time since `start` (from `now()`) to a section. */
  add(section: ProfileSection, start: number): void {
    if (!this.enabled) return;
    this.current[INDEX[section]] += now() - start;
  }

  /** Add an externally measured duration (ms) to a section. */
  addMs(section: ProfileSection, ms: number): void {
    if (this.enabled) this.current[INDEX[section]] += ms;
  }

  beginFrame(timestamp?: number): void {
    if (!this.enabled) return;
    const t = now();
    this.frameStart = t;
    const ts = timestamp ?? t;
    this.intervals[this.head] = this.lastFrame < 0 ? 0 : ts - this.lastFrame;
    this.lastFrame = ts;
  }

  endFrame(): void {
    if (!this.enabled) return;
    const base = this.head * N;
    // Navball and HUD run in their own rAF/React tasks; count them with the frame they follow.
    this.cpu[this.head] = now() - this.frameStart + this.current[INDEX.navball] + this.current[INDEX.hud];
    for (let i = 0; i < N; i++) { this.history[base + i] = this.current[i]; this.current[i] = 0; }
    this.head = (this.head + 1) % PROFILE_HISTORY;
    if (this.count < PROFILE_HISTORY) this.count++;
    this.totalFrames++;
  }

  reset(): void {
    this.current.fill(0); this.history.fill(0); this.intervals.fill(0); this.cpu.fill(0);
    this.head = 0; this.count = 0; this.lastFrame = -1; this.totalFrames = 0;
  }

  /** Oldest-to-newest frame intervals into `out` (returns the number written). */
  graph(out: Float64Array): number {
    const n = Math.min(this.count, out.length);
    for (let i = 0; i < n; i++) out[i] = this.intervals[(this.head - n + i + PROFILE_HISTORY) % PROFILE_HISTORY];
    return n;
  }

  summary(): ProfileSummary {
    // The first retained interval after (re)enabling has no predecessor; skip zero intervals.
    const n = this.count;
    let m = 0, sum = 0, max = 0, h25 = 0, h50 = 0, cpuSum = 0, cpuMax = 0;
    for (let i = 0; i < n; i++) {
      const v = this.intervals[i];
      const c = this.cpu[i];
      cpuSum += c; if (c > cpuMax) cpuMax = c;
      if (v <= 0) continue;
      this.scratch[m++] = v; sum += v; if (v > max) max = v;
      if (v > 25) h25++;
      if (v > 50) h50++;
    }
    const sorted = this.scratch.subarray(0, m).sort();
    const pct = (p: number) => (m ? sorted[Math.min(m - 1, Math.floor(p * m))] : 0);
    const cpuSorted = Float64Array.from(this.cpu.subarray(0, n)).sort();
    const sections = {} as Record<ProfileSection, number>;
    for (let s = 0; s < N; s++) {
      let acc = 0;
      for (let i = 0; i < n; i++) acc += this.history[i * N + s];
      sections[PROFILE_SECTIONS[s]] = n ? acc / n : 0;
    }
    const avg = m ? sum / m : 0;
    return {
      frames: n,
      fps: avg > 0 ? 1000 / avg : 0,
      frameMs: { avg, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max },
      cpuMs: { avg: n ? cpuSum / n : 0, p95: n ? cpuSorted[Math.min(n - 1, Math.floor(0.95 * n))] : 0, max: cpuMax },
      sections,
      hitches25: h25,
      hitches50: h50,
    };
  }
}

/** Shared instance used by the flight controller, HUD and performance overlay. */
export const frameProfiler = new FrameProfiler();
