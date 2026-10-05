/** Sustained frame-time hysteresis; scale is relative to the user's chosen ceiling. */
export class AdaptiveQuality {
  scale = 1;
  private slow = 0;
  private fast = 0;
  update(frameMs: number, enabled: boolean): boolean {
    const previous = this.scale;
    if (!enabled) { this.scale = 1; this.slow = this.fast = 0; }
    else if (Number.isFinite(frameMs) && frameMs > 0 && frameMs < 1000) {
      this.slow = frameMs > 25 ? this.slow + frameMs : 0;
      this.fast = frameMs < 12 ? this.fast + frameMs : 0;
      if (this.slow >= 3000) { this.scale = Math.max(0.5, +(this.scale - 0.1).toFixed(2)); this.slow = 0; }
      if (this.fast >= 3000) { this.scale = Math.min(1, +(this.scale + 0.1).toFixed(2)); this.fast = 0; }
    } else this.slow = this.fast = 0; // Do not react to suspended/background tabs.
    return previous !== this.scale;
  }
}
