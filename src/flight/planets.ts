import { heliocentricRanges, mayBeWithin } from '../sim/orbit/bounds';
import { CometEffects } from '../render/planet/CometEffects';
import * as THREE from 'three';
import type { Universe } from '../game/universe';
import { length, sub, type Vec3 } from '../util/vec3';
import { getQuality, type QualityId } from '../render/core';
import { PlanetRenderer } from '../render/planet/PlanetRenderer';
import { SCALE_PRESETS } from '../sim/bodies/scale';

export interface PlanetLayerUpdate {
  t: number;
  /** Floating origin (heliocentric, float64). */
  origin: Vec3;
  camera: THREE.PerspectiveCamera;
  sunPos: Vec3;
  dt: number;
  /** Body the active vessel is near (gets full-detail treatment). */
  focusBody: string;
  viewportHeight?: number;
}

export interface PlanetLayer {
  update(u: PlanetLayerUpdate): void;
  /** 0..1 fraction of the sun visible from a point (eclipses / atmospheric extinction, luminance). */
  sunVisibility?(point: Vec3, sunPos: Vec3): number;
  /** Per-channel sun transmittance (for tinting the sun light at sunset). */
  sunTint?(point: Vec3, sunPos: Vec3): [number, number, number];
  /** True when the body's renderer has no pending terrain work (or it isn't rendered at all). */
  isIdle?(id: string): boolean;
  /** Surface ready; decorative scatter need not hold flight controls behind a loading screen. */
  isSurfaceReady?(id: string): boolean;
  dispose(): void;
}

/** Angular radius thresholds (radians) for creating / destroying a body's renderer (hysteresis). */
const CREATE_ANGLE = 4e-4;
const DESTROY_ANGLE = 2e-4;

/**
 * Manages PlanetRenderers for the flight scene: the Sun always, plus any body large enough on screen.
 * Renderers use the same deterministic terrain instances as the physics, so what you see is what you land on.
 */
export function createPlanetLayer(scene: THREE.Scene, universe: Universe, qualityId: QualityId, renderer?: THREE.WebGLRenderer): PlanetLayer {
  const quality = getQuality(qualityId);
  // Without WEBGL_multi_draw (Firefox) three draws a batch chunk by chunk, still sharing one program setup and vertex
  // array: two GL calls per chunk instead of four or more.
  const batchTerrain = qualityId !== 'low' && !!renderer;
  const scale = SCALE_PRESETS[universe.preset];
  const renderers = new Map<string, PlanetRenderer>();
  const comets = new Map([...universe.bodies.values()].filter(b => b.kind === 'comet').map(b => {
    const fx = new CometEffects(); scene.add(fx.root); return [b.id, fx] as const;
  }));
  let lastT = 0;
  let lastOrigin: Vec3 = { x: 0, y: 0, z: 0 };

  const make = (id: string) => {
    const b = universe.body(id);
    const terrain = b.solidSurface ? universe.terrain(id) : null;
    const pr = new PlanetRenderer(b, terrain, { quality, scale, batchTerrain, renderer });
    scene.add(pr.root);
    renderers.set(id, pr);
    return pr;
  };

  const occluders = (point: Vec3, sunPos: Vec3) => {
    let tint: [number, number, number] = [1, 1, 1];
    for (const [id, pr] of renderers) {
      if (universe.body(id).kind === 'star') continue;
      const bp = universe.ephem.getBodyState(id, lastT).position;
      const v = pr.sunVisibility(point, bp, sunPos);
      tint = [tint[0] * v[0], tint[1] * v[1], tint[2] * v[2]];
    }
    const lum = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2];
    return { lum, tint };
  };

  return {
    update(u) {
      for (const [id, fx] of comets) fx.update(universe.ephem.getBodyState(id, u.t).position, u.sunPos,
        u.origin, universe.body(id).radius, 149597870700 * scale.s, u.t);
      lastT = u.t;
      lastOrigin = u.origin;
      // Bodies that cannot be within creation range (from their heliocentric distance bounds) are skipped
      // without evaluating their ephemeris: same decisions, a handful of Kepler solves per frame instead of ~60.
      const ranges = heliocentricRanges(universe.bodies), r = length(u.origin);
      // Renderer construction (geometry, materials, LUTs) costs tens of ms: besides the Sun and the focused body,
      // create at most one per frame so a scene load or SOI change does not build them all in one long task.
      let created = 0;
      for (const b of universe.bodies.values()) {
        const extent = Math.max(b.radius + (b.atmosphere?.height ?? 0), b.rings?.outerRadius ?? 0);
        const has = renderers.has(b.id);
        const keep = b.kind === 'star' || b.id === u.focusBody;
        if (!has && !keep && !mayBeWithin(ranges.get(b.id)!, r, extent / CREATE_ANGLE)) continue;
        const bp = universe.ephem.getBodyState(b.id, u.t).position;
        const d = Math.max(1, length(sub(bp, u.origin)));
        const ang = extent / d;
        if (!has && (keep || (ang > CREATE_ANGLE && created === 0))) { make(b.id); if (!keep) created++; }
        else if (has && !keep && ang < DESTROY_ANGLE) {
          const pr = renderers.get(b.id)!;
          pr.root.removeFromParent();
          pr.dispose();
          renderers.delete(b.id);
        }
      }
      for (const [id, pr] of renderers) {
        const bs = universe.ephem.getBodyState(id, u.t);
        pr.update({
          camera: u.camera,
          origin: u.origin,
          bodyPosition: bs.position,
          bodyRotation: universe.ephem.bodyRotation(id, u.t),
          sunPosition: u.sunPos,
          dt: u.dt,
          time: u.t,
          viewportHeight: u.viewportHeight,
        });
      }
    },
    isSurfaceReady(id) {
      return renderers.get(id)?.surfaceReady ?? true;
    },
    isIdle(id) {
      return renderers.get(id)?.idle ?? true;
    },
    sunVisibility(point, sunPos) {
      void lastOrigin;
      return occluders(point, sunPos).lum;
    },
    sunTint(point, sunPos) {
      return occluders(point, sunPos).tint;
    },
    dispose() {
      for (const fx of comets.values()) fx.dispose();
      for (const pr of renderers.values()) {
        pr.root.removeFromParent();
        pr.dispose();
      }
      renderers.clear();
    },
  };
}
