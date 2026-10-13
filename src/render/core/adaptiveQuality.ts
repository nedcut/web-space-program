/**
 * Adaptive render scale: a multiplier (0.5–1) on the user's render-scale ceiling, driven by
 * one-second windows of frame intervals and, when the browser exposes GPU timer queries, GPU time.
 *
 * - Over budget (≥20% of frames miss the display interval, the mean rate is >12% below the target, or GPU
 *   time ≥90% of the interval) for two windows
 *   (one when severe) → scale down; with GPU timings straight to the scale predicted to fit 80% of
 *   the budget (pixels ∝ scale²), otherwise 0.1 (0.15 when most frames miss).
 * - The mean-rate test catches steady 45–55 fps on high-refresh (ProMotion) displays, where intervals quantise to
 *   16.7/25 ms and few frames exceed 1.5× the target; Mac browsers may not expose GPU timer queries at all.
 * - Headroom (≤2% missed frames, mean rate within 5% of the target and, if known, GPU time ≤60% of the interval)
 *   → scale up (0.1, or
 *   towards the predicted 70%-budget scale) after a
 *   cooldown that doubles whenever an increase is undone within a few seconds (no oscillation).
 * - When GPU timing shows the GPU is idle, slow frames are CPU-bound and resolution is left alone.
 * - Reductions are judged as an episode: once the scale is ≥0.25 below where the overload started and the mean
 *   frame interval has not improved by ≥7% (the limit is not pixels — main thread, another tab, the compositor),
 *   the starting scale is restored and reductions pause (20 s, doubling to ~3 min) instead of sinking to the
 *   minimum for nothing. Single steps are not judged alone: with strict vsync a step can show no gain until the
 *   frame fits the next interval.
 * - Frames over 250 ms (loading, tab switch, debugger) are ignored, and so is everything during `hold` (after a
 *   WebGL context restore every program recompiles over a few seconds of slow but sub-250 ms frames).
 * - Uncapped, the budget is the display interval (8.3 ms at 120 Hz), estimated from the fastest fifth of each
 *   window's intervals rather than its single fastest one (a lone short interval after a late frame must not
 *   tighten the budget). Reductions that only chase a rate above 60 fps stop at `highRateMin`; below 60 fps the
 *   full range applies. A 120 Hz frame stream alternating 8.3/16.7 ms (~100 fps) is therefore over budget, also
 *   in Firefox, which has no GPU timer queries. Still over budget at that floor for 8 windows → a 3-window trial at
 *   full scale; the steady mean intervals decide (≤7% worse at full scale → keep it and pause reductions, else back
 *   to the floor and trial again after 30 s, doubling to 10 min).
 */
export class AdaptiveQuality {
  scale = 1;
  /** Intentional frame pacing must not be mistaken for GPU overload. */
  frameRateCap = 0;
  readonly min = 0.5;
  /** Lowest scale used to reach a frame rate above 60 fps (uncapped high-refresh display). */
  readonly highRateMin = 0.75;
  /** Estimated display refresh interval (ms); a slowly relaxing minimum of observed intervals. */
  refreshMs = 1000 / 60;
  private elapsed = 0;
  private frames = 0;
  private slow = 0;
  /** Frames that would also miss a 60 fps budget (> 25 ms). */
  private slow60 = 0;
  /** This window's frame intervals (for the display-interval estimate); extra frames beyond its length are not kept. */
  private readonly intervals = new Float32Array(512);
  private gpuSum = 0;
  private gpuN = 0;
  private bad = 0;
  private goodMs = 0;
  private cooldownMs = 4000;
  private sinceUpMs = Infinity;

  private cpuSum = 0;
  private cpuN = 0;
  /** Reduction episode under evaluation: scale and mean frame interval when it began, windows since the last step. */
  private episode: { from: number; meanBefore: number; since: number } | null = null;
  private downBlockedMs = 0;
  private downBlockMs = 20000;
  private holdMs = 0;
  /** Windows spent over budget at the >60 fps floor, and their summed mean interval. */
  private floorWindows = 0;
  private floorSum = 0;
  /** Full-resolution trial from the floor: the floor's scale and mean interval, windows measured at full scale. */
  private probe: { floorScale: number; floorMean: number; windows: number; sum: number } | null = null;
  private probeBlockedMs = 0;
  private probeBlockMs = 30000;

  /** Ignore frames for the next `ms` of frame time (a known transient stall, not sustained load). */
  hold(ms: number): void {
    this.holdMs = Math.max(this.holdMs, ms);
    this.resetWindow();
    this.bad = 0;
    this.goodMs = 0;
  }

  /**
   * @param gpuMs GPU time of the frame's rendering from timer queries, when available.
   * @param cpuMs main-thread time spent on the frame, when known. Timer queries miss GPU work outside
   *   the measured passes (browser compositing, other contexts), so "GPU idle" only implies a CPU-bound
   *   frame when the main thread really is busy.
   */
  update(frameMs: number, enabled: boolean, gpuMs?: number, cpuMs?: number): boolean {
    const previous = this.scale;
    if (!enabled) { this.scale = 1; this.probe = null; this.floorWindows = 0; this.floorSum = 0; this.resetWindow(); this.bad = 0; this.goodMs = 0; this.episode = null; this.downBlockedMs = 0; return previous !== this.scale; }
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs >= 250) { this.resetWindow(); return false; }
    if (this.holdMs > 0) { this.holdMs -= frameMs; return false; }
    this.frames++;
    this.elapsed += frameMs;
    this.sinceUpMs += frameMs;
    this.downBlockedMs = Math.max(0, this.downBlockedMs - frameMs);
    this.probeBlockedMs = Math.max(0, this.probeBlockedMs - frameMs);
    if (this.frames <= this.intervals.length) this.intervals[this.frames - 1] = frameMs;
    if (frameMs > this.targetMs * 1.5) this.slow++;
    if (frameMs > 25) this.slow60++;
    if (gpuMs !== undefined && Number.isFinite(gpuMs) && gpuMs >= 0) { this.gpuSum += gpuMs; this.gpuN++; }
    if (cpuMs !== undefined && Number.isFinite(cpuMs) && cpuMs >= 0) { this.cpuSum += cpuMs; this.cpuN++; }
    if (this.elapsed < 1000) return false;

    // Track the display interval: drop to faster observed rates at once, relax ~0.2% per window.
    const fast = lowQuantile(this.intervals, Math.min(this.frames, this.intervals.length), 0.2);
    this.refreshMs = Math.min(1000 / 30, Math.max(1000 / 240, Math.min(this.refreshMs * 1.002, fast)));
    const slowFrac = this.slow / this.frames;
    const gpu = this.gpuN ? this.gpuSum / this.gpuN : NaN;
    const cpu = this.cpuN ? this.cpuSum / this.cpuN : NaN;
    const cpuBusy = !Number.isFinite(cpu) || cpu > this.targetMs * 0.7;
    const gpuIdle = Number.isFinite(gpu) && gpu < this.targetMs * 0.6 && cpuBusy;
    const meanMs = this.elapsed / this.frames;
    // Above 60 fps only missed frames count: timer queries overlap pipelined frames (the owner's Mac Chrome read
    // 10.2 ms of GPU per frame while holding 120 fps). GPU time still sizes the steps and detects CPU-bound frames.
    const highRate = this.targetMs < 1000 / 60 - 0.5;
    const gpuBudget = highRate ? NaN : gpu;
    const over = !gpuIdle && (slowFrac >= 0.2 || meanMs > this.targetMs * 1.12 || gpuBudget >= this.targetMs * 0.9);
    // Over budget only relative to a >60 fps display rate: lower the resolution, but not below highRateMin.
    const meets60 = highRate && this.slow60 / this.frames < 0.2 && meanMs <= (1000 / 60) * 1.12;
    const floor = meets60 ? this.highRateMin : this.min;
    const headroom = slowFrac <= 0.02 && meanMs <= this.targetMs * 1.05 && !(gpuBudget >= this.targetMs * 0.6);
    const windowMs = this.elapsed;
    this.resetWindow();

    // Full-resolution trial (see below): keep whichever of floor / full scale has the better steady frame interval.
    const probe = this.probe;
    if (probe) {
      probe.sum += meanMs;
      if (++probe.windows < 3) return false;
      this.probe = null;
      if (probe.sum / probe.windows > probe.floorMean * 1.07) {
        // Pixel-bound after all: back to the floor, trial again later.
        this.scale = probe.floorScale;
        this.probeBlockedMs = this.probeBlockMs;
        this.probeBlockMs = Math.min(600000, this.probeBlockMs * 2);
      } else {
        // Resolution was not the limit (compositor, main thread, a vsync source that cannot reach the rate).
        this.downBlockedMs = this.downBlockMs;
        this.downBlockMs = Math.min(160000, this.downBlockMs * 2);
      }
      this.bad = 0; this.goodMs = 0;
      return previous !== this.scale;
    }

    const ep = this.episode;
    if (ep) {
      ep.since++;
      if (meanMs <= Math.max(ep.meanBefore * 0.93, this.targetMs * 1.05)) this.episode = null; // it helped
      else if (ep.since >= 2 && ep.from - this.scale >= 0.25 - 1e-9) {
        this.scale = ep.from;
        this.episode = null;
        this.downBlockedMs = this.downBlockMs;
        this.downBlockMs = Math.min(160000, this.downBlockMs * 2);
        this.bad = 0; this.goodMs = 0;
        return previous !== this.scale;
      }
    }

    // Paused after a useless episode, or holding a ≥0.25 reduction until it has been judged.
    const holding = !!this.episode && this.episode.from - this.scale >= 0.25 - 1e-9;
    if (!over || this.scale > floor) { this.floorWindows = 0; this.floorSum = 0; }
    if (over && (this.downBlockedMs > 0 || holding || this.scale <= floor)) {
      this.bad = 0; this.goodMs = 0;
      // Stopped at the >60 fps floor: a later reduction (below 60 fps) is judged from here, not from above it.
      if (this.scale <= floor && !holding) this.episode = null;
      // Still missing the display rate at the floor. The episode test can be fooled by a transient (loading
      // during the reduction), so after a while try full resolution again and compare steady intervals.
      if (meets60 && this.scale <= floor && !holding && this.scale < 1) {
        this.floorWindows++; this.floorSum += meanMs;
        if (this.floorWindows >= 8 && this.probeBlockedMs <= 0) {
          this.probe = { floorScale: this.scale, floorMean: this.floorSum / this.floorWindows, windows: 0, sum: 0 };
          this.floorWindows = 0; this.floorSum = 0;
          this.scale = 1;
          return previous !== this.scale;
        }
      }
    } else if (over) {
      this.goodMs = 0;
      // Severe overload acts after one window; marginal overload needs two in a row.
      const severe = slowFrac > 0.5 || meanMs > this.targetMs * 1.5 || gpuBudget > this.targetMs * 1.3;
      if (++this.bad >= (severe ? 1 : 2)) {
        this.bad = 0;
        // GPU time scales with pixel count (scale²): jump straight to the predicted scale for ~80% of the
        // budget when timings are available, otherwise take fixed steps.
        const predicted = Number.isFinite(gpu) && gpu > 0 ? this.scale * Math.sqrt((this.targetMs * 0.8) / gpu) : NaN;
        const step = Number.isFinite(predicted) ? Math.min(0.35, Math.max(0.1, this.scale - predicted)) : slowFrac > 0.5 ? 0.15 : 0.1;
        const next = Math.max(floor, +(this.scale - step).toFixed(2));
        if (next < this.scale) {
          // An increase that had to be undone quickly: wait longer before trying again.
          if (this.sinceUpMs < 6000) this.cooldownMs = Math.min(60000, this.cooldownMs * 2);
          if (this.episode) this.episode.since = 0;
          else this.episode = { from: this.scale, meanBefore: meanMs, since: 0 };
          this.scale = next;
        }
      }
    } else if (headroom) {
      this.bad = 0;
      this.goodMs += windowMs;
      if (this.scale < 1 && this.goodMs >= this.cooldownMs) {
        // With GPU timings, climb towards the scale predicted to use ~70% of the budget (≤ +0.2 per step).
        const predicted = Number.isFinite(gpu) && gpu > 0 ? this.scale * Math.sqrt((this.targetMs * 0.7) / gpu) : NaN;
        const step = Number.isFinite(predicted) ? Math.min(0.2, Math.max(0.05, predicted - this.scale)) : 0.1;
        this.scale = Math.min(1, +(this.scale + step).toFixed(2));
        this.goodMs = 0;
        this.sinceUpMs = 0;
      }
    } else {
      this.bad = 0;
      this.goodMs = 0;
    }
    return previous !== this.scale;
  }

  /** Frame-time goal: the cap's interval (never faster than the display), or the display interval when uncapped. */
  get targetMs(): number { return this.frameRateCap ? Math.max(this.refreshMs, 1000 / this.frameRateCap) : this.refreshMs; }

  private resetWindow(): void {
    this.elapsed = 0; this.frames = 0; this.slow = 0; this.slow60 = 0; this.gpuSum = 0; this.gpuN = 0; this.cpuSum = 0; this.cpuN = 0;
  }
}

/** The q-quantile of a[0..n) (n > 0), by in-place selection (reorders the prefix; no allocation). */
function lowQuantile(a: Float32Array, n: number, q: number): number {
  const k = Math.min(n - 1, Math.floor(q * n));
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else break;
  }
  return a[k];
}
