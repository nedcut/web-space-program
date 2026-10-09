import { describe, expect, it } from 'vitest';
import { dockingModeAfterEvent } from '../src/flight/dockingMode';

describe('docking mode after a dock', () => {
  it('switches off when the active vessel docks, whichever side survives the merge', () => {
    expect(dockingModeAfterEvent(true, { type: 'docked', vesselId: 'a', otherId: 'b' }, 'a')).toBe(false);
    expect(dockingModeAfterEvent(true, { type: 'docked', vesselId: 'b', otherId: 'a' }, 'a')).toBe(false);
  });
  it('ignores other vessels, other events and an already-off mode', () => {
    expect(dockingModeAfterEvent(true, { type: 'docked', vesselId: 'b', otherId: 'c' }, 'a')).toBe(true);
    expect(dockingModeAfterEvent(true, { type: 'undocked', vesselId: 'a' }, 'a')).toBe(true);
    expect(dockingModeAfterEvent(false, { type: 'docked', vesselId: 'a', otherId: 'b' }, 'a')).toBe(false);
  });
});
