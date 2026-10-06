/**
 * Adaptive render scale: a multiplier (0.5–1) on the user's render-scale ceiling, driven by
 * one-second windows of frame intervals and, when the browser exposes GPU timer queries, GPU time.
 *
 * - Over budget (≥20% of frames miss the display interval, or GPU time ≥90% of it) for two windows
 *   (one when severe) → scale down; with GPU timings straight to the scale predicted to fit 80% of
 *   the budget (pixels ∝ scale²), otherwise 0.1 (0.15 when most frames miss).
 * - Headroom (≤2% missed frames and, if known, GPU time ≤60% of the interval) → scale up (0.1, or
 *   towards the predicted 70%-budget scale) after a
 *   cooldown that doubles whenever an increase is undone within a few seconds (no oscillation).
 * - When GPU timing shows the GPU is idle, slow frames are CPU-bound and resolution is left alone.
 * - Frames over 250 ms (loading, tab switch, debugger) are ignored.
 */
export class AdaptiveQuality {
  scale = 1;
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

  update(frameMs: number, enabled: boolean, gpuMs?: number): boolean {
    const previous = this.scale;
    if (!enabled) { this.scale = 1; this.resetWindow(); this.bad = 0; this.goodMs = 0; return previous !== this.scale; }
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs >= 250) { this.resetWindow(); return false; }
    this.frames++;
    this.elapsed += frameMs;
    this.sinceUpMs += frameMs;
    if (frameMs < this.windowMin) this.windowMin = frameMs;
    if (frameMs > this.targetMs * 1.5) this.slow++;
    if (gpuMs !== undefined && Number.isFinite(gpuMs) && gpuMs >= 0) { this.gpuSum += gpuMs; this.gpuN++; }
    if (this.elapsed < 1000) return false;

    // Track the display interval: drop to faster observed rates at once, relax ~0.2% per window.
    this.refreshMs = Math.min(1000 / 30, Math.max(1000 / 240, Math.min(this.refreshMs * 1.002, this.windowMin)));
    const slowFrac = this.slow / this.frames;
    const gpu = this.gpuN ? this.gpuSum / this.gpuN : NaN;
    const gpuIdle = Number.isFinite(gpu) && gpu < this.targetMs * 0.6;
    const over = !gpuIdle && (slowFrac >= 0.2 || (Number.isFinite(gpu) && gpu >= this.targetMs * 0.9));
    const headroom = slowFrac <= 0.02 && (!Number.isFinite(gpu) || gpuIdle);
    const windowMs = this.elapsed;
    this.resetWindow();

    if (over) {
      this.goodMs = 0;
      // Severe overload acts after one window; marginal overload needs two in a row.
      const severe = slowFrac > 0.5 || (Number.isFinite(gpu) && gpu > this.targetMs * 1.3);
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

  /** Frame-time goal: the display interval, but never chase more than 60 fps on fast displays. */
  get targetMs(): number { return Math.max(this.refreshMs, 1000 / 60); }

  private resetWindow(): void {
    this.elapsed = 0; this.frames = 0; this.slow = 0; this.gpuSum = 0; this.gpuN = 0; this.windowMin = Infinity;
  }
}
