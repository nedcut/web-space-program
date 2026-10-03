import { BODY_DEFS } from '../../data/bodies';
import { buildUniverse, SCALE_PRESETS, type ScalePresetId } from './scale';
import type { Body } from './types';

export * from './types';
export * from './scale';
export { BODY_DEFS } from '../../data/bodies';

export function createUniverse(preset: ScalePresetId = 'standard'): Map<string, Body> {
  return buildUniverse(BODY_DEFS, SCALE_PRESETS[preset]);
}
