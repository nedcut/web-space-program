/** Axis-aligned box in the pad frame (metres: +X east, +Y up, +Z south): size x/z, centre x/z, bottom/top y. */
export interface PadBox { w: number; d: number; x: number; z: number; y0: number; y1: number }

/** Grating bar pitch and width (m): narrow enough to walk on, open enough to show the trench below. */
export const GRATING_PITCH = 0.4;
const BAR = 0.07;

/**
 * Walkway grating over the flame hole (|x|, |z| < half) and the open trench (z from `openStart` north to
 * `trenchEnd`), flush with the deck (top 5 mm below y = 0): bars along the trench on cross beams every ~2.5 m.
 * Collision ground is flat across the pad, so this is what an astronaut stands on (DECISIONS: pad flame pit).
 */
export function padGrating(half: number, openStart: number, trenchEnd: number): PadBox[] {
  const boxes: PadBox[] = [];
  const span = (zA: number, zB: number) => {
    const beams = Math.max(1, Math.round((zA - zB) / 2.5));
    for (let i = 0; i <= beams; i++) boxes.push({ w: 2 * half - 0.02, d: 0.16, x: 0, z: zB + 0.1 + ((zA - zB - 0.2) * i) / beams, y0: -0.3, y1: -0.08 });
    for (let x = -half + GRATING_PITCH / 2; x < half - 0.1; x += GRATING_PITCH) boxes.push({ w: BAR, d: zA - zB, x, z: (zA + zB) / 2, y0: -0.08, y1: -0.005 });
  };
  span(half, -half);
  span(openStart, trenchEnd);
  return boxes;
}
