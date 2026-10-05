import { generateAsteroidField, asteroidState, asteroidDefinition } from '../sim/bodies/asteroidField';
import { buildUniverse, SCALE_PRESETS } from '../sim/bodies/scale';
import { BODY_DEFS } from '../data/bodies';
import { qRotate, qConj } from '../util/quat';
import { concentrationAt } from '../sim/resources/deposits';
import type { Body } from '../sim/bodies/types';
import { createUniverse, type ScalePresetId } from '../sim/bodies';
import { createEphemeris, type Ephemeris } from '../sim/orbit/ephemeris';
import { createTerrain, type Terrain } from '../sim/terrain';
import { findDominantBody } from '../sim/orbit/soi';
import { sampleAtmosphere } from '../sim/atmosphere';
import type { Environment, GroundSample } from '../sim/vessel/env';
import { add, cross, length, normalize, scale, sub, v3, type Vec3 } from '../util/vec3';

/**
 * The playable universe: scaled bodies, ephemeris, and lazily-created terrains,
 * plus an `Environment` implementation for the vessel simulation.
 */
export class Universe {
  readonly bodies: Map<string, Body>;
  readonly asteroidField = generateAsteroidField();
  readonly activatedAsteroids = new Set<string>();
  readonly ephem: Ephemeris;
  readonly sunId: string;
  private terrains = new Map<string, Terrain>();

  constructor(readonly preset: ScalePresetId) {
    this.bodies = createUniverse(preset);
    this.ephem = createEphemeris(this.bodies);
    this.sunId = [...this.bodies.values()].find((b) => b.kind === 'star')!.id;
  }

  asteroidState(id: string, t: number) {
    const seed = this.asteroidField.find(a => a.id === id);
    if (!seed) throw new Error(`Unknown asteroid ${id}`);
    return asteroidState(seed, this.body(this.sunId).gm, SCALE_PRESETS[this.preset].s, t);
  }

  /** Only targeted/nearby field objects join gravity, terrain and conic prediction. */
  activateAsteroid(id: string): boolean {
    if (this.bodies.has(id)) return false;
    const seed = this.asteroidField.find(a => a.id === id);
    if (!seed) return false;
    const b = buildUniverse([BODY_DEFS.find(b => b.id === 'sun')!, asteroidDefinition(seed)], SCALE_PRESETS[this.preset]).get(id)!;
    this.bodies.set(id, b);
    this.body(this.sunId).children.push(id);
    this.activatedAsteroids.add(id);
    return true;
  }

  activateNearbyAsteroids(position: Vec3, t: number): void {
    // 1000 km in playable metres, irrespective of scale preset.
    const radialDistance = length(position), s = SCALE_PRESETS[this.preset].s;
    for (const a of this.asteroidField) {
      if (this.activatedAsteroids.has(a.id)) continue;
      if (radialDistance < a.orbit.a * s * (1 - a.orbit.e) - 1e6 || radialDistance > a.orbit.a * s * (1 + a.orbit.e) + 1e6) continue;
      const state = this.asteroidState(a.id, t);
      if (length(sub(state.position, position)) <= 1e6) this.activateAsteroid(a.id);
    }
  }

  body(id: string): Body {
    const b = this.bodies.get(id);
    if (!b) throw new Error(`Unknown body ${id}`);
    return b;
  }

  terrain(id: string): Terrain {
    let t = this.terrains.get(id);
    if (!t) {
      t = createTerrain(this.body(id));
      this.terrains.set(id, t);
    }
    return t;
  }

  dominantBody(posHelio: Vec3, t: number): string {
    this.activateNearbyAsteroids(posHelio, t);
    return findDominantBody(this.ephem, this.bodies, posHelio, t);
  }

  /** Body-fixed unit direction & altitude info for a heliocentric position. */
  surfaceInfo(bodyId: string, posHelio: Vec3, t: number) {
    const b = this.body(bodyId);
    const rel = sub(posHelio, this.ephem.getBodyState(bodyId, t).position);
    const r = length(rel);
    const fixed = this.ephem.toBodyFixed(bodyId, rel, t);
    const inv = 1 / (r || 1);
    const ux = fixed.x * inv;
    const uy = fixed.y * inv;
    const uz = fixed.z * inv;
    const terrainH = b.solidSurface ? this.terrain(bodyId).heightAt(ux, uy, uz) : 0;
    const ocean = b.solidSurface && this.terrain(bodyId).ocean;
    const surfaceH = ocean ? Math.max(this.terrain(bodyId).liquid?.level ?? 0, terrainH) : terrainH;
    return {
      rel,
      r,
      altitude: r - b.radius,
      terrainHeight: terrainH,
      heightAboveTerrain: r - b.radius - surfaceH,
      lat: Math.asin(Math.max(-1, Math.min(1, uz))),
      lon: Math.atan2(uy, ux),
      fixedDir: v3(ux, uy, uz),
    };
  }

  /**
   * Environment for the vessel sim. `dominant` is re-evaluated by the world each tick (cheap getter here)
   * so queries inside one integration step are consistent.
   */
  createEnvironment(getDominant: () => string, nbody = false): Environment {
    // Returned Environment methods have their own receiver; capture the owning universe.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      integrateRelative: ['asteroid', 'comet'].includes(self.body(getDominant()).kind),
      regolithConcentration(pos, t) {
        const id = getDominant();
        const dir = qRotate(qConj(self.ephem.bodyRotation(id, t)), sub(pos, self.ephem.getBodyState(id, t).position));
        return concentrationAt(self.body(id), dir);
      },
      gravity(pos, t) {
        const id = getDominant();
        let acc = v3();
        const addBody = (bid: string) => {
          const bp = self.ephem.getBodyState(bid, t).position;
          const d = sub(bp, pos);
          const r2 = d.x * d.x + d.y * d.y + d.z * d.z;
          acc = add(acc, scale(d, self.body(bid).gm / (r2 * Math.sqrt(r2))));
        };
        addBody(id);
        if (nbody) {
          // Perturbations from the parent chain (third-body effect relative to the dominant body's own acceleration).
          let p = self.body(id).parent;
          while (p) {
            const bp = self.ephem.getBodyState(p, t).position;
            const dv = sub(bp, pos);
            const dc = sub(bp, self.ephem.getBodyState(id, t).position);
            const gm = self.body(p).gm;
            const r1 = length(dv);
            const r2 = length(dc);
            acc = add(acc, sub(scale(dv, gm / (r1 * r1 * r1)), scale(dc, gm / (r2 * r2 * r2))));
            p = self.body(p).parent;
          }
        }
        return acc;
      },
      air(pos, t) {
        const id = getDominant();
        const b = self.body(id);
        const bs = self.ephem.getBodyState(id, t);
        const rel = sub(pos, bs.position);
        const alt = length(rel) - b.radius;
        const sample = sampleAtmosphere(b.atmosphere, alt, b.surfaceGravity);
        const wind = add(bs.velocity, self.ephem.surfaceVelocity(id, rel, t));
        return { sample, windVelocity: wind };
      },
      ground(pos, t) {
        const id = getDominant();
        const b = self.body(id);
        if (!b.solidSurface) return null;
        const terr = self.terrain(id);
        const bs = self.ephem.getBodyState(id, t);
        const rel = sub(pos, bs.position);
        const r = length(rel);
        if (r - b.radius > terr.maxHeight + 5000) return null;
        const fixed = normalize(self.ephem.toBodyFixed(id, rel, t));
        const hAt = (x: number, y: number, z: number) => {
          const h = terr.heightAt(x, y, z);
          return terr.ocean ? Math.max(terr.liquid?.level ?? 0, h) : h;
        };
        const rawHeight = terr.heightAt(fixed.x, fixed.y, fixed.z);
        const h = terr.ocean ? Math.max(terr.liquid?.level ?? 0, rawHeight) : rawHeight;
        const isWater = terr.ocean && rawHeight < (terr.liquid?.level ?? 0);
        // Surface normal from finite differences (≈1 m spacing in tangent directions).
        const eps = Math.min(1 / b.radius, 1e-4);
        const tA = normalize(Math.abs(fixed.z) < 0.9 ? cross(v3(0, 0, 1), fixed) : cross(v3(1, 0, 0), fixed));
        const tB = cross(fixed, tA);
        const pA = normalize(add(fixed, scale(tA, eps)));
        const pB = normalize(add(fixed, scale(tB, eps)));
        const P0 = scale(fixed, b.radius + h);
        const PA = scale(pA, b.radius + hAt(pA.x, pA.y, pA.z));
        const PB = scale(pB, b.radius + hAt(pB.x, pB.y, pB.z));
        let nFixed = normalize(cross(sub(PA, P0), sub(PB, P0)));
        if (nFixed.x * fixed.x + nFixed.y * fixed.y + nFixed.z * fixed.z < 0) nFixed = scale(nFixed, -1);
        const surfRel = self.ephem.fromBodyFixed(id, P0, t);
        const sample: GroundSample = {
          surfacePoint: add(bs.position, surfRel),
          normal: normalize(self.ephem.fromBodyFixed(id, nFixed, t)),
          surfaceVelocity: add(bs.velocity, self.ephem.surfaceVelocity(id, surfRel, t)),
          isWater,
          liquidDensity: terr.liquid?.density,
        };
        return sample;
      },
      sun(pos, t) {
        const sp = self.ephem.getBodyState(self.sunId, t).position;
        const d = sub(sp, pos);
        const dist = length(d);
        return { dir: scale(d, 1 / dist), distance: dist };
      },
      referenceBody(_pos, t) {
        const s = self.ephem.getBodyState(getDominant(), t);
        return { position: s.position, velocity: s.velocity };
      },
    };
  }
}
