export function deadZone(value: number, zone = 0.15, sensitivity = 1): number {
  if (!Number.isFinite(value)) return 0;
  const d = Math.max(0, Math.min(0.95, zone));
  return Math.sign(value) * Math.min(1, Math.max(0, (Math.abs(value) - d) / (1 - d)) * sensitivity);
}
/** Standard browser mapping: LB selects translation, sticks otherwise control attitude. */
export function mapGamepad(pad: Pick<Gamepad, 'axes' | 'buttons'>, zone: number, sensitivity: number, eva = false) {
  const a = (i: number) => deadZone(pad.axes[i] ?? 0, zone, sensitivity);
  const b = (i: number) => pad.buttons[i]?.value ?? 0;
  const translation = eva || b(4) > 0.5;
  return { pitch: translation ? 0 : a(1), yaw: translation ? 0 : a(0), roll: translation ? 0 : a(2),
    tx: translation ? a(0) : 0, ty: translation ? -a(3) : 0, tz: translation ? a(1) : 0,
    throttle: b(7) - b(6), run: b(10) > 0.5, brakes: b(1) > 0.5 };
}
