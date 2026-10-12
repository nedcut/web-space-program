import { describe, expect, it } from 'vitest';
import { dockingStatus, fixed } from '../src/flight/hud/TargetPanel';
import { formatSpeed } from '../src/util/format';
import type { DockingTelemetry } from '../src/flight/hud/Hud';

const base: DockingTelemetry = {
  myPort: 'a', targetPort: 'b', myPortUid: 1, targetPortUid: 2, targetId: 't', sizeMatch: true, x: 0, y: 0, z: 0.4, vx: 0, vy: 0, vz: -0.1,
  angle: 2, tiltX: 0, tiltY: 0, captureRange: 0.5, captureSpeed: 0.5, captureAngle: 10, armed: true,
};

describe('docking indicator status', () => {
  it('reports CAPTURE only inside the whole capture envelope', () => {
    expect(dockingStatus(base)).toBe('CAPTURE');
  });
  it('says APPROACH when lined up but out of range, ALIGN only for real misalignment', () => {
    expect(dockingStatus({ ...base, z: 5, angle: 3.1 })).toBe('APPROACH');
    expect(dockingStatus({ ...base, z: 5, angle: 12 })).toBe('ALIGN');
    expect(dockingStatus({ ...base, z: 5, x: 2 })).toBe('ALIGN');
    expect(dockingStatus({ ...base, z: 5, x: 0.3, y: -0.3, angle: 9 })).toBe('APPROACH');
    expect(dockingStatus({ ...base, z: 5, armed: false })).toBe('REARMING');
  });
  it('explains why an in-range pair will not latch', () => {
    expect(dockingStatus({ ...base, vz: -0.8 })).toBe('TOO FAST');
    expect(dockingStatus({ ...base, angle: 15 })).toBe('MISALIGNED');
    expect(dockingStatus({ ...base, armed: false })).toBe('REARMING');
    expect(dockingStatus({ ...base, sizeMatch: false })).toBe('SIZE MISMATCH');
  });
});

describe('docking readout formatting', () => {
  it('never prints a negative zero', () => {
    expect(fixed(-0.001)).toBe('0.00');
    expect(fixed(-0.004, 1)).toBe('0.0');
    expect(fixed(-0.25)).toBe('-0.25');
    expect(formatSpeed(-0.01)).toBe('0.0 m/s');
    expect(formatSpeed(-0.3)).toBe('-0.3 m/s');
  });
});
