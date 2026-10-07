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
 * - Frames over 250 ms (loading, tab switch, debugger) are ignored.
 */
export class AdaptiveQuality {
  scale = 1;
  /** Intentional frame pacing must not be mistaken for GPU overload. */
  frameRateCap = 0;
  readonly min = 0.5;
  /** Estimated display refresh interval (ms); a slowly relaxing minimum of observed intervals. */
  refreshMs = 1000 / 60;
  private elapsed = 0;
  private frames = 0;
  private slow = 0;
  private gpuSum = 0;
  private gpuN = 0;
  private windowMin = Infinity;
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

  /**
   * @param gpuMs GPU time of the frame's rendering from timer queries, when available.
   * @param cpuMs main-thread time spent on the frame, when known. Timer queries miss GPU work outside
   *   the measured passes (browser compositing, other contexts), so "GPU idle" only implies a CPU-bound
   *   frame when the main thread really is busy.
   */
  update(frameMs: number, enabled: boolean, gpuMs?: number, cpuMs?: number): boolean {
    const previous = this.scale;
    if (!enabled) { this.scale = 1; this.resetWindow(); this.bad = 0; this.goodMs = 0; this.episode = null; this.downBlockedMs = 0; return previous !== this.scale; }
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs >= 250) { this.resetWindow(); return false; }
    this.frames++;
    this.elapsed += frameMs;
    this.sinceUpMs += frameMs;
    this.downBlockedMs = Math.max(0, this.downBlockedMs - frameMs);
    if (frameMs < this.windowMin) this.windowMin = frameMs;
    if (frameMs > this.targetMs * 1.5) this.slow++;
    if (gpuMs !== undefined && Number.isFinite(gpuMs) && gpuMs >= 0) { this.gpuSum += gpuMs; this.gpuN++; }
    if (cpuMs !== undefined && Number.isFinite(cpuMs) && cpuMs >= 0) { this.cpuSum += cpuMs; this.cpuN++; }
    if (this.elapsed < 1000) return false;

    // Track the display interval: drop to faster observed rates at once, relax ~0.2% per window.
    this.refreshMs = Math.min(1000 / 30, Math.max(1000 / 240, Math.min(this.refreshMs * 1.002, this.windowMin)));
    const slowFrac = this.slow / this.frames;
    const gpu = this.gpuN ? this.gpuSum / this.gpuN : NaN;
    const cpu = this.cpuN ? this.cpuSum / this.cpuN : NaN;
    const cpuBusy = !Number.isFinite(cpu) || cpu > this.targetMs * 0.7;
    const gpuIdle = Number.isFinite(gpu) && gpu < this.targetMs * 0.6 && cpuBusy;
    const meanMs = this.elapsed / this.frames;
    const over = !gpuIdle && (slowFrac >= 0.2 || meanMs > this.targetMs * 1.12 || (Number.isFinite(gpu) && gpu >= this.targetMs * 0.9));
    const headroom = slowFrac <= 0.02 && meanMs <= this.targetMs * 1.05 && (!Number.isFinite(gpu) || gpu < this.targetMs * 0.6);
    const windowMs = this.elapsed;
    this.resetWindow();

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
    if (over && (this.downBlockedMs > 0 || holding)) {
      this.bad = 0; this.goodMs = 0;
    } else if (over) {
      this.goodMs = 0;
      // Severe overload acts after one window; marginal overload needs two in a row.
      const severe = slowFrac > 0.5 || meanMs > this.targetMs * 1.5 || (Number.isFinite(gpu) && gpu > this.targetMs * 1.3);
      if (++this.bad >= (severe ? 1 : 2)) {
        this.bad = 0;
        // GPU time scales with pixel count (scale²): jump straight to the predicted scale for ~80% of the
        // budget when timings are available, otherwise take fixed steps.
        const predicted = Number.isFinite(gpu) && gpu > 0 ? this.scale * Math.sqrt((this.targetMs * 0.8) / gpu) : NaN;
        const step = Number.isFinite(predicted) ? Math.min(0.35, Math.max(0.1, this.scale - predicted)) : slowFrac > 0.5 ? 0.15 : 0.1;
        const next = Math.max(this.min, +(this.scale - step).toFixed(2));
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

  /** Frame-time goal: cap/display interval. Unlimited retains the default 60 fps adaptive target. */
  get targetMs(): number { return Math.max(this.refreshMs, 1000 / (this.frameRateCap || 60)); }

  private resetWindow(): void {
    this.elapsed = 0; this.frames = 0; this.slow = 0; this.gpuSum = 0; this.gpuN = 0; this.cpuSum = 0; this.cpuN = 0; this.windowMin = Infinity;
  }
}
