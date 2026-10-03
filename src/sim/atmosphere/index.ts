import type { AtmosphereDef } from '../bodies/types';
import type { AtmosphereSample } from './api';

export type { AtmosphereSample } from './api';
export const ATM = 101325;
const R = 8.31446261815324;

function vacuum(): AtmosphereSample {
  return { pressure: 0, density: 0, temperature: 0, speedOfSound: 0 };
}

/** Hydrostatic ideal gas model; pass the body's surfaceGravity as g0.
 * Layer altitudes and lapse rates are used directly, including scaled profiles.
 * Below the datum, use datum conditions. Above the last layer, continue its lapse rate.
 */
export function sampleAtmosphere(
  atmo: AtmosphereDef | undefined,
  altitude: number,
  g0 = 9.80665,
): AtmosphereSample {
  if (!atmo || atmo.height <= 0 || altitude >= atmo.height || Number.isNaN(altitude)) return vacuum();
  const h = Math.max(0, altitude);
  let temperature = atmo.surfaceTemperature;
  let pressure = atmo.surfacePressure;
  const advance = (distance: number, lapse: number) => {
    if (distance <= 0) return;
    // A positive floor prevents extrapolated lapse profiles from crossing absolute zero.
    const nextTemperature = Math.max(1, temperature + lapse * distance);
    if (Math.abs(lapse) < 1e-12) {
      pressure *= Math.exp(-atmo.molarMass * g0 * distance / (R * temperature));
    } else {
      const validDistance = (nextTemperature - temperature) / lapse;
      pressure *= Math.pow(nextTemperature / temperature, -atmo.molarMass * g0 / (R * lapse));
      if (distance > validDistance) {
        pressure *= Math.exp(-atmo.molarMass * g0 * (distance - validDistance) / (R * nextTemperature));
      }
    }
    temperature = nextTemperature;
  };

  const layers = atmo.layers;
  if (layers?.length) {
    // Profiles are ordered by base altitude. Before a nonzero first base, remain isothermal.
    advance(Math.min(h, Math.max(0, layers[0].altitude)), 0);
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (h <= layer.altitude) break;
      const top = Math.min(h, layers[i + 1]?.altitude ?? h);
      advance(top - Math.max(0, layer.altitude), layer.lapseRate);
    }
  } else {
    advance(h, 0);
  }

  const fadeStart = atmo.height * 0.95;
  const x = Math.max(0, Math.min(1, (h - fadeStart) / (atmo.height - fadeStart)));
  const fade = 1 - x * x * (3 - 2 * x);
  // The cutoff tail is artificial: taper temperature and density together, so pressure
  // tapers quadratically and the returned sample still obeys the ideal-gas/sound equations.
  const density = pressure * atmo.molarMass / (R * temperature) * fade;
  pressure *= fade * fade;
  temperature *= fade;
  return {
    pressure,
    density,
    temperature,
    speedOfSound: Math.sqrt(atmo.gamma * R * temperature / atmo.molarMass),
  };
}

/** Speed magnitude divided by local sound speed; vacuum gives Infinity for nonzero speed. */
export function machNumber(speed: number, speedOfSound: number): number {
  return speedOfSound > 0 ? Math.abs(speed) / speedOfSound : speed === 0 ? 0 : Infinity;
}

export function dynamicPressure(rho: number, v: number): number {
  return 0.5 * rho * v * v;
}
