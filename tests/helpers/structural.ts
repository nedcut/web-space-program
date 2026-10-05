import { expect } from 'vitest';
import type { World } from '../../src/game/world';

/** Stock flight regressions must preserve every active attachment, including nonessential hardware. */
export function requireIntactFlight(world: World): void {
  const previous = world.onEvent;
  world.onEvent = event => {
    previous?.(event);
    if (event.vesselId === world.activeId && event.type === 'structuralFailure') {
      expect(event, `Stock attachment failed at UT ${world.ut}, q=${world.active?.state.telemetry.dynamicPressure} Pa`).toBeUndefined();
    }
  };
}
