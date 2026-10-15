import { acquireSurfaceBake } from './sharedBake';
import { releasePixels } from '../texturePixels';
import { SurfaceFeatures } from './SurfaceFeatures';
import * as THREE from 'three';
import { CloudMap } from './cloudMap';
import { RestoreHook } from '../core/contextRecovery';
import { skyOcclusionRadius } from './skyOcclusion';
import type { BodyDef } from '../../sim/bodies/types';
import type { Terrain } from '../../sim/terrain/api';
import { SCALE_PRESETS, type ScaleConfig } from '../../sim/bodies/scale';
import type { Vec3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';
import { QUALITY_PRESETS, type QualitySettings } from '../core/quality';
import { screenSpaceFactor } from '../core/camera';
import { computeAtmosphereParams, buildTransmittanceLUT, type AtmosphereParams } from './atmosphereParams';
import { createPlanetUniforms, registerPlanetUniforms, shaderTime, unregisterPlanetUniforms, WaveClock, type PlanetUniforms } from './uniforms';
import {
  createTerrainMaterial,
  type TerrainMaterialOptions,
  createOceanMaterial,
  createFarSphereMaterial,
  createGasGiantMaterial,
  createSkyMaterial,
  createCloudMaterial,
  enableCloudShadows,
  enableEarthImagery,
  createRingMaterial,
  createSunMaterial,
  type GasGiantStyle,
} from './materials';
import { Quadtree, VIEW_KEY } from './quadtree';
import { TerrainWorkerPool } from './workerPool';
import { buildRingProfile } from './textures';
import { RingParticles } from './RingParticles';
import { createPlanetEffect } from './effects';
import { adaptedPlanetshine, discAlbedo, reflectedIrradiance, type PlanetLightSource } from './planetshine';
import { SurfaceScatter } from './scatter/SurfaceScatter';
import { terrainCutout } from './cutout';
import { EarthImagery, seasonMonth } from './earthImagery';

export interface PlanetRendererOptions {
  /** Portraits bake surface detail without allocating close-up terrain. */
  farOnly?: boolean;
  /** Draw visible terrain chunks as one batch per planet (needs `renderer`); otherwise ordinary chunk meshes. */
  batchTerrain?: boolean;
  /** Host renderer: the terrain batch owns GPU buffers on its context. */
  renderer?: THREE.WebGLRenderer;
  /** Map uniforms must not replace the live flight lighting registry. */
  registerUniforms?: boolean;
  quality: QualitySettings;
  /** Universe scale (for atmosphere scale heights and artistic sun falloff). Default: standard. */
  scale?: ScaleConfig;
  /** Shared worker pool (default: TerrainWorkerPool.shared). */
  pool?: TerrainWorkerPool;
  /** Solar irradiance at 1 AU in renderer HDR units (default 4). */
  sunIlluminance?: number;
  /** Sun-disc radiance (HDR) for the star material and the in-atmosphere sun disc (default 60). */
  sunRadiance?: number;
  /** Smallest terrain wavelength used when creating worker terrains (must match `terrain`). */
  terrainMinWavelength?: number;
}

export interface PlanetUpdateParams {
  camera: THREE.PerspectiveCamera;
  /** Floating origin (float64 sim/inertial position that maps to render (0,0,0)). */
  origin: Vec3;
  /** Body centre, float64 inertial. */
  bodyPosition: Vec3;
  /** Body-fixed → inertial rotation. */
  bodyRotation: Quat;
  /** Sun centre, float64 inertial. */
  sunPosition: Vec3;
  /** Seconds since last frame (animation). */
  dt: number;
  /** Simulation time (s) for deterministic animation; defaults to accumulated dt. */
  time?: number;
  /** Drawing-buffer height in pixels (for LOD). Default: 1080. */
  viewportHeight?: number;
  /** Height for the near/far terrain switch only, when it should ignore transient resolution drops. Default: viewportHeight. */
  switchViewportHeight?: number;
}

export type PlanetKind = 'star' | 'gas' | 'solid';

const lightSources = new Map<PlanetRenderer, PlanetLightSource>();

const AU = 149597870700;

/**
 * Renders one celestial body: quadtree terrain + ocean (solid bodies), baked far sphere, banded gas
 * giant shader, sun, atmosphere shell (single scattering), clouds, rings. Add `root` to the scene and
 * call `update()` every frame BEFORE rendering.
 */
/** Large baked textures must never replace close-up geometry with the smooth far sphere. */
export function wantsTerrainLod(radius: number, cameraDistance: number, projectedRadius: number, textureWidth: number, colorDominated: boolean): boolean {
  const threshold = Math.max(140, Math.min(2048, textureWidth) / (colorDominated ? 2 : 5));
  return cameraDistance < radius * 1.1 || projectedRadius > threshold;
}

export class PlanetRenderer {
  private surfaceFeatures?: SurfaceFeatures;
  readonly root = new THREE.Group();
  private readonly viewKey = new Float64Array(VIEW_KEY);
  private readonly viewQuat = new THREE.Quaternion();
  private readonly camQuat = new THREE.Quaternion();
  readonly body: BodyDef;
  readonly kind: PlanetKind;
  readonly terrain: Terrain | null;
  readonly atmosphere: AtmosphereParams | null;
  readonly uniforms: PlanetUniforms;
  private quality: QualitySettings;
  private scale: ScaleConfig;
  private pool: TerrainWorkerPool | null = null;
  private scatter: SurfaceScatter | null = null;
  private quadtree: Quadtree | null = null;
  private terrainVariants: { base: THREE.ShaderMaterial; detail: THREE.ShaderMaterial; far: THREE.ShaderMaterial; active: THREE.ShaderMaterial; ocean?: THREE.ShaderMaterial } | null = null;
  private farSphere: THREE.Mesh | null = null;
  private farMaterial: THREE.ShaderMaterial | null = null;
  private farTexture: THREE.DataTexture | null = null;
  /** The last update wanted near (quadtree) terrain: until its roots are built, the far sphere is a stand-in. */
  private wantNear = false;
  private bakeRequested = false;
  private surfaceBake?: ReturnType<typeof acquireSurfaceBake>;
  private disposed = false;
  private sky: THREE.Mesh | null = null;
  /** Real Earth imagery (Earth only; null elsewhere or when unavailable). */
  readonly imagery: EarthImagery | null = null;
  /** Renderer drawing this planet (seen in material callbacks): imagery uploads/merges run through it. */
  private glRenderer: THREE.WebGLRenderer | null = null;
  /** Dev/automation: pin the imagery month (0–11) instead of following the season. */
  seasonOverride: number | null = null;
  private readonly imageryStart = typeof performance !== 'undefined' ? performance.now() : 0;
  private clouds: THREE.Mesh | null = null;
  private cloudRadius = 0;
  private cloudMap: CloudMap | null = null;
  private cloudSourceBound = false;
  /** Imagery and the cloud bake are GPU-only content: rebuilt after a context restore (renderer seen in onBeforeRender). */
  private readonly restoreHook = new RestoreHook(() => this.restoreGpuContent());
  /** Renderer seen by the cloud mesh's onBeforeRender; used to bake the cloud map in update(). */
  private bakeRenderer: THREE.WebGLRenderer | null = null;
  private readonly cloudRotM = new THREE.Matrix3();
  private rings: THREE.Mesh | null = null;
  private ringParticles: RingParticles | null = null;
  private ringTexture: THREE.DataTexture | null = null;
  private effects: THREE.Mesh[] = [];
  private sunMesh: THREE.Mesh | null = null;
  private materials: THREE.Material[] = [];
  private lut: THREE.DataTexture | null = null;
  private frame = 0;
  private timeAcc = 0;
  private readonly waveClock = new WaveClock();
  private sunIlluminance: number;
  private sunRadiance: number;
  private readonly terrainKey: string;
  private readonly hostRenderer?: THREE.WebGLRenderer;
  private readonly frustum = new THREE.Frustum();
  private readonly tmpM4 = new THREE.Matrix4();
  private readonly inverseRotation = new THREE.Quaternion();
  private readonly scatterOffset = new THREE.Vector3();
  private readonly rotQ = new THREE.Quaternion();
  private readonly rotM = new THREE.Matrix3();
  private readonly rotM4 = new THREE.Matrix4();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Sphere();
  /** Exposed for HUD/debug. */
  stats = { mode: 'far' as 'far' | 'near' | 'none', chunks: 0, meshes: 0, inflight: 0, queued: 0, projectedRadiusPx: 0, altitude: 0 };

  constructor(body: BodyDef, terrain: Terrain | null, opts: PlanetRendererOptions) {
    this.body = body;
    this.terrain = terrain;
    this.quality = opts.quality;
    this.scale = opts.scale ?? SCALE_PRESETS.standard;
    this.sunIlluminance = opts.sunIlluminance ?? 4;
    this.sunRadiance = opts.sunRadiance ?? 60;
    this.hostRenderer = opts.renderer;
    this.root.name = `planet:${body.id}`;
    this.root.userData.planet = this; // diagnostics/automation
    // Identity container: placed children update themselves; do not force every cached chunk each frame.
    this.root.matrixAutoUpdate = false;
    this.terrainKey = `${JSON.stringify(body)}:${opts.terrainMinWavelength ?? 6}`;
    const preset = body.surface?.preset ?? 'rocky';
    this.kind = body.kind === 'star' || preset === 'star' ? 'star' : !body.solidSurface || preset === 'gasGiant' || preset === 'iceGiant' ? 'gas' : 'solid';

    this.atmosphere = this.kind === 'star' ? null : computeAtmosphereParams(body, this.scale);
    if (this.atmosphere) this.lut = buildTransmittanceLUT(this.atmosphere);
    this.uniforms = createPlanetUniforms(body.radius, this.atmosphere, this.lut);
    if (opts.quality.atmosphereScattering === false) this.uniforms.uHasAtmo.value = 0;
    if (opts.registerUniforms !== false) registerPlanetUniforms(body.id, this.uniforms);
    // Optically thick Titan needs the same integration budget on its disc and limb to avoid a seam.
    if (body.id === 'titan' && this.quality.planetDetails.volumeSteps > 0) {
      this.uniforms.uStepScale.value = Math.ceil(64 / this.quality.atmosphere.aerialSteps);
    }

    if (body.id === 'earth' && this.kind === 'solid') {
      this.imagery = new EarthImagery({ quality: opts.quality.earth.textureQuality, nightLights: opts.quality.earth.nightLights,
        radius: body.radius, maxLevel: opts.farOnly ? '4k' : undefined,
        clouds: !opts.farOnly && !!terrain && opts.quality.clouds });
      enableEarthImagery(this.uniforms, this.imagery.uniforms);
      this.root.userData.imagery = this.imagery; // diagnostics/automation
    }
    if (this.kind === 'star') this.buildSun();
    else if (this.kind === 'gas') this.buildGasGiant();
    else this.buildSolid(opts);

    if (this.atmosphere && opts.quality.atmosphereScattering !== false) this.buildSky();
    if (body.rings && this.kind !== 'star') this.buildRings();
    if (this.quality.planetDetails.volumeSteps > 0) {
      const id = body.id;
      const kind = this.kind === 'star' ? 'corona' : id;
      if (kind === 'enceladus' || kind === 'io' || (kind === 'titan' && opts.quality.atmosphereScattering !== false) || kind === 'earth' || kind === 'corona') {
        const extent = kind === 'enceladus' ? 1.8 : kind === 'io' ? 1.22 : kind === 'corona' ? 1.65
          : kind === 'titan' ? 1 + (this.atmosphere!.atmosphereRadius / body.radius - 1) * 1.18 : 1.045;
        const effect = createPlanetEffect(this.uniforms, this.quality, kind, extent);
        this.effects.push(effect);
        this.materials.push(effect.material as THREE.Material);
        this.root.add(effect);
      }
    }
    if (body.id === 'titan') {
      for (const material of this.materials) if (material instanceof THREE.ShaderMaterial) material.defines.TITAN_HAZE = 1;
    }
    if (this.imagery) {
      const capture = (r: THREE.WebGLRenderer) => { this.glRenderer = r; this.restoreHook.attach(r); };
      for (const m of this.materials) m.onBeforeRender = capture;
    }
    if (body.id === 'earth' && this.quality.earth.nightLights) {
      for (const material of this.materials) if (material instanceof THREE.ShaderMaterial) material.defines.EARTH_DETAILS = 1;
    }
    lightSources.set(this, { position: { x: 0, y: 0, z: 0 }, radius: body.radius,
      albedo: discAlbedo(body.id, body.surface?.colors), sunDirection: { x: 1, y: 0, z: 0 }, irradiance: 0 });
  }

  // ------------------------------------------------------------------ construction

  private buildSun(): void {
    const geo = new THREE.SphereGeometry(1, this.quality.sphereSegments, this.quality.sphereSegments / 2);
    const mat = createSunMaterial(this.body.surface?.colors ?? [], this.sunRadiance);
    this.materials.push(mat);
    this.sunMesh = new THREE.Mesh(geo, mat);
    this.sunMesh.scale.setScalar(this.body.radius);
    this.sunMesh.matrixAutoUpdate = false;
    this.sunMesh.frustumCulled = false;
    this.root.add(this.sunMesh);
  }

  private gasStyle(): GasGiantStyle {
    const id = this.body.id;
    const colors = this.body.surface?.colors ?? [];
    if (id === 'saturn') return { style: 1, colors, bandFreq: 30, turbulence: 0.5, contrast: 0.55 };
    if (id === 'uranus') return { style: 2, colors, bandFreq: 16, turbulence: 0.15, contrast: 0.12 };
    if (id === 'neptune') return { style: 3, colors, bandFreq: 14, turbulence: 0.5, contrast: 0.35 };
    if (this.body.surface?.preset === 'iceGiant') return { style: 2, colors, bandFreq: 16, turbulence: 0.2, contrast: 0.2 };
    return { style: 0, colors, bandFreq: 26, turbulence: 1.0, contrast: 1.35 };
  }

  private buildGasGiant(): void {
    const seg = this.quality.sphereSegments;
    const geo = new THREE.SphereGeometry(1, seg, seg / 2);
    geo.rotateX(Math.PI / 2); // poles on ±Z (body frame)
    const mat = createGasGiantMaterial(this.uniforms, this.quality, this.gasStyle());
    this.materials.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.scale.setScalar(this.body.radius);
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    this.farSphere = m;
    this.root.add(m);
  }

  private buildSolid(opts: PlanetRendererOptions): void {
    const q = this.quality;
    const terrain = this.terrain;
    const preset = this.body.surface?.preset ?? 'rocky';
    const airless = this.atmosphere ? 0 : preset === 'lunar' || preset === 'mercury' || preset === 'rocky' ? 0.85 : 0.6;
    const minH = terrain?.minHeight ?? 0;
    const maxH = terrain?.maxHeight ?? 0;
    const ocean = !!terrain?.ocean;
    const wantClouds = !!terrain && !opts.farOnly && q.clouds && (preset === 'earth' || this.body.id === 'earth') && !!this.atmosphere;
    if (wantClouds) enableCloudShadows(this.uniforms);

    // Far sphere (always available as fallback).
    const seg = q.sphereSegments;
    const geo = new THREE.SphereGeometry(1, seg, seg / 2);
    if (preset === 'irregular' && terrain) {
      const positions = geo.getAttribute('position');
      const p = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).normalize();
        p.multiplyScalar(1 + terrain.heightAt(p.x, p.y, p.z) / this.body.radius);
        positions.setXYZ(i, p.x, p.y, p.z);
      }
      geo.computeVertexNormals(); geo.computeBoundingSphere();
    }
    this.farMaterial = createFarSphereMaterial(this.uniforms, q, { airless, ocean: ocean && this.body.id !== 'titan', minH, maxH: Math.max(maxH, minH + 1), texWidth: q.bakedTextureWidth, irregular: preset === 'irregular' });
    const pal = this.body.surface?.colors?.[1] ?? this.body.surface?.colors?.[0] ?? [0.3, 0.3, 0.3];
    (this.farMaterial.uniforms.uFallback.value as THREE.Vector3).set(pal[0], pal[1], pal[2]);
    this.materials.push(this.farMaterial);
    this.farSphere = new THREE.Mesh(geo, this.farMaterial);
    this.farSphere.scale.setScalar(this.body.radius);
    this.farSphere.matrixAutoUpdate = false;
    this.farSphere.frustumCulled = false;
    this.root.add(this.farSphere);

    if (!terrain) return;
    this.pool = opts.pool ?? TerrainWorkerPool.shared(q.terrain.workers);
    this.pool.register(this.terrainKey, this.body, terrain, opts.terrainMinWavelength ?? 6);

    if (opts.farOnly) return;

    const rockByPreset: Record<string, [number, number, number]> = {
      earth: [0.16, 0.145, 0.125],
      mars: [0.22, 0.11, 0.06],
      lunar: [0.13, 0.125, 0.12],
    };
    const rock = rockByPreset[preset] ?? (this.body.surface?.colors?.[0] as [number, number, number]) ?? [0.15, 0.14, 0.13];
    const terrainOptions: TerrainMaterialOptions = {
      rockColor: rock,
      rockBlend: preset === 'earth' ? 1 : preset === 'mars' ? 0.6 : 0.35,
      airless,
      detail: q.terrain.detail,
      duneRipples: preset === 'mars',
      detailStrength: preset === 'earth' ? 1 : preset === 'mars' ? 1.5 : 1.0,
      cutout: terrainCutout(this.body.id),
      craters: preset === 'lunar' || preset === 'mercury' || preset === 'rocky',
      surfaceShadows: preset !== 'earth' && this.body.id !== 'earth',
    };
    const terrainMat = createTerrainMaterial(this.uniforms, q, terrainOptions);
    this.materials.push(terrainMat);
    let oceanMat: THREE.ShaderMaterial | undefined;
    if (ocean) {
      oceanMat = createOceanMaterial(this.uniforms, { ...q, atmosphere: QUALITY_PRESETS[q.earth.oceanQuality].atmosphere }, [0.35, 0.31, 0.22], terrain?.liquid?.kind === 'hydrocarbon');
      this.materials.push(oceanMat);
    }
    if (this.imagery && q.earth.textureQuality !== 'low') {
      const detail = createTerrainMaterial(this.uniforms, q, { ...terrainOptions, regional: 'detail' });
      const far = createTerrainMaterial(this.uniforms, q, { ...terrainOptions, regional: 'far' });
      this.terrainVariants = { base: terrainMat, detail, far, active: terrainMat, ocean: oceanMat };
      this.materials.push(detail, far);
    }
    const R = this.body.radius;
    // Max depth so vertex spacing at the finest level ≈ minVertexSpacing.
    const faceEdge = (Math.PI / 2) * R;
    const maxLevel = Math.max(2, Math.min(22, Math.ceil(Math.log2(faceEdge / q.terrain.chunkResolution / q.terrain.minVertexSpacing))));
    this.quadtree = new Quadtree({
      terrainKey: this.terrainKey,
      radius: R,
      minHeight: minH,
      maxHeight: maxH,
      res: q.terrain.chunkResolution,
      maxLevel,
      ocean,
      pool: this.pool,
      terrainMaterial: terrainMat,
      terrainWarmupMaterials: this.terrainVariants ? [this.terrainVariants.base, this.terrainVariants.detail, this.terrainVariants.far] : undefined,
      oceanMaterial: oceanMat,
      maxInFlight: q.terrain.maxInFlight,
      buildBudgetMs: q.terrain.buildBudgetMs,
      cacheSize: q.terrain.cacheSize,
      cacheBytes: q.terrain.cacheMB * 1048576,
      batch: opts.batchTerrain && opts.renderer ? opts.renderer.getContext() as WebGL2RenderingContext : undefined,
    });
    this.root.add(this.quadtree.group);
    if (terrain) { this.surfaceFeatures = new SurfaceFeatures(this.body, terrain); this.root.add(this.surfaceFeatures.group); }
    if (q.scatter.radius > 0) {
      this.scatter = new SurfaceScatter(this.body, terrain, q, this.uniforms);
      this.root.add(this.scatter.group);
    }

    if (wantClouds && this.atmosphere) {
      const H = this.atmosphere.atmosphereRadius - R;
      this.cloudRadius = R + Math.min(H * 0.08, 6000);
      this.cloudMap = new CloudMap(q.earth.cloudQuality === 'ultra' ? 2048 : q.earth.cloudQuality === 'high' ? 1536 : q.earth.cloudQuality === 'medium' ? 1024 : 512, terrain!.heightAt);
      this.uniforms.uCloudMap.value = this.cloudMap.target.texture;
      const cgeo = new THREE.SphereGeometry(1, 96, 48);
      const cmat = createCloudMaterial(this.uniforms, q, this.cloudRadius);
      this.materials.push(cmat);
      this.clouds = new THREE.Mesh(cgeo, cmat);
      this.clouds.scale.setScalar(this.cloudRadius * 1.01);
      this.clouds.matrixAutoUpdate = false;
      this.clouds.frustumCulled = false;
      this.clouds.renderOrder = 2;
      this.clouds.onBeforeRender = (renderer) => { this.restoreHook.attach(renderer); if (!this.cloudMap?.done) this.bakeRenderer = renderer; };
      this.root.add(this.clouds);
    }
  }

  private buildSky(): void {
    const a = this.atmosphere!;
    const geo = new THREE.SphereGeometry(1, 96, 48);
    const mat = createSkyMaterial(this.uniforms, this.quality);
    mat.uniforms.uSunRadiance.value = this.sunRadiance;
    this.materials.push(mat);
    this.sky = new THREE.Mesh(geo, mat);
    // Slightly larger than the atmosphere top so tessellation never clips the shell.
    this.sky.scale.setScalar(a.atmosphereRadius * 1.002);
    this.sky.matrixAutoUpdate = false;
    this.sky.frustumCulled = false;
    this.sky.renderOrder = 1;
    this.root.add(this.sky);
  }

  private buildRings(): void {
    const rd = this.body.rings!;
    const envelopes: Record<string, [number, number]> = {
      saturn: [66900, 140200],
      uranus: [41837, 51149],
      jupiter: [92000, 226000],
    };
    const profile = rd.profile ?? 'saturn';
    const env = envelopes[profile] ?? [rd.innerRadius / 1000, rd.outerRadius / 1000];
    const pad = 0.012;
    const inner = rd.innerRadius * (1 - pad);
    const outer = rd.outerRadius * (1 + pad);
    const tex = buildRingProfile(profile, env[0] * (1 - pad), env[1] * (1 + pad), rd.opacity ?? 0.8);
    this.ringTexture = tex;
    const geo = new THREE.RingGeometry(inner, outer, this.quality.ringSegments, 4);
    const mat = createRingMaterial(this.uniforms, this.quality, tex, inner, outer);
    // Faint dusty rings mostly scatter light; they barely occlude what is behind them.
    if (profile === 'jupiter') mat.uniforms.uOcclusion.value = 0.25;
    this.materials.push(mat);
    this.rings = new THREE.Mesh(geo, mat);
    this.rings.matrixAutoUpdate = false;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 3;
    this.root.add(this.rings);
    this.uniforms.uHasRings.value = 1;
    this.uniforms.uRingInner.value = inner;
    this.uniforms.uRingOuter.value = outer;
    this.uniforms.uRingProfile.value = tex;
    if (this.quality.planetDetails.ringCells > 0) {
      this.ringParticles = new RingParticles(this.uniforms, this.quality, tex.image.data as Uint8Array, inner, outer);
      this.root.add(this.ringParticles.group);
      mat.uniforms.uParticleRange.value = this.ringParticles.range;
    }
  }

  // ------------------------------------------------------------------ per frame

  update(p: PlanetUpdateParams): void {
    this.frame++;
    this.timeAcc += p.dt;
    const time = p.time ?? this.timeAcc;
    const u = this.uniforms;
    const R = this.body.radius;
    const cam = p.camera;
    cam.updateMatrixWorld();

    // Float64: body centre relative to origin, camera relative to body.
    const bx = p.bodyPosition.x - p.origin.x;
    const by = p.bodyPosition.y - p.origin.y;
    const bz = p.bodyPosition.z - p.origin.z;
    const crx = cam.position.x - bx, cry = cam.position.y - by, crz = cam.position.z - bz;
    const camDist2 = crx * crx + cry * cry + crz * crz;
    const camDist = Math.sqrt(camDist2);
    if (this.imagery) {
      // Preserve the local pad/scatter material on the ground; fade in the regional view during liftoff.
      this.imagery.uniforms.uEarthRegionView.value = camDist < R * 1.16 ? THREE.MathUtils.smoothstep(camDist - R, 50, 150) : 0;
    }
    u.uPlanetCenter.value.set(bx, by, bz);
    u.uCamRel.value.set(crx, cry, crz);
    const Ra = this.atmosphere?.atmosphereRadius ?? R;
    u.uCamCAtm.value = (camDist - Ra) * (camDist + Ra);
    u.uCamCGround.value = (camDist - R) * (camDist + R);
    u.uTime.value = shaderTime(time);
    u.uWaveTime.value = this.waveClock.update(time, p.dt);

    const q = p.bodyRotation;
    this.rotQ.set(q.x, q.y, q.z, q.w);
    this.rotM4.makeRotationFromQuaternion(this.rotQ);
    this.rotM.setFromMatrix4(this.rotM4);
    u.uBodyRot.value.copy(this.rotM);
    u.uRingNormal.value.set(0, 0, 1).applyQuaternion(this.rotQ);

    // Sun direction & (artistically compressed) irradiance.
    const sx = p.sunPosition.x - p.bodyPosition.x, sy = p.sunPosition.y - p.bodyPosition.y, sz = p.sunPosition.z - p.bodyPosition.z;
    const sd = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    u.uSunDir.value.set(sx / sd, sy / sd, sz / sd);
    // Seasons follow the orbit (scaled universes shorten the year): Sun's ecliptic longitude → month.
    this.imagery?.update(this.seasonOverride ?? seasonMonth(Math.atan2(sy, sx)));
    if (this.imagery && this.glRenderer) this.imagery.step(this.glRenderer);
    const auScaled = AU * this.scale.s;
    const E = this.kind === 'star' ? 0 : this.sunIlluminance * Math.pow(auScaled / Math.max(sd, auScaled * 0.2), 0.3);
    u.uSunColor.value.set(E, E * 0.985, E * 0.96);
    const source = lightSources.get(this)!;
    Object.assign(source.position, p.bodyPosition);
    source.sunDirection.x = sx / sd; source.sunDirection.y = sy / sd; source.sunDirection.z = sz / sd;
    source.irradiance = E;
    u.uPlanetshineColor.value.setScalar(0);
    // Nearby parent renderers already exist in flight. Keep solar positions in float64 here.
    for (const [renderer, parent] of lightSources) {
      if (this.quality.id === 'low' || !this.root.parent || renderer.body.id !== this.body.parent || renderer.kind === 'star' || renderer.root.parent !== this.root.parent) continue;
      const dx = parent.position.x - p.bodyPosition.x, dy = parent.position.y - p.bodyPosition.y, dz = parent.position.z - p.bodyPosition.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance <= parent.radius) continue;
      const phase = -(dx * parent.sunDirection.x + dy * parent.sunDirection.y + dz * parent.sunDirection.z) / distance;
      const strength = adaptedPlanetshine(reflectedIrradiance(parent.radius, distance, phase)) * parent.irradiance;
      u.uPlanetshineDir.value.set(dx / distance, dy / distance, dz / distance);
      u.uPlanetshineColor.value.set(parent.albedo[0] * strength, parent.albedo[1] * strength, parent.albedo[2] * strength);
      break;
    }
    if (this.sky) {
      const mat = this.sky.material as THREE.ShaderMaterial;
      // Angular radius of the sun as seen from this body (≈ R_sun / d).
      mat.uniforms.uSunAngularRadius.value = Math.max((696e6 * this.scale.s) / sd, 0.0015);
    }

    // Body-fixed camera for LOD.
    const inv = this.inverseRotation.copy(this.rotQ).invert();
    const camBF = this.tmpV.set(crx, cry, crz).applyQuaternion(inv);
    const camBFx = camBF.x, camBFy = camBF.y, camBFz = camBF.z;

    if (this.terrainVariants && this.imagery) {
      const variants = this.terrainVariants;
      // Latitude/longitude margins contain every point within the pack's 0.16-radius draw range.
      const nearGulf = camBFy < 0 && camBFx > camBFy * 0.425 && camBFx < -camBFy * 0.933
        && camBFz > 0 && camBFz < camDist * 0.708;
      const regional = nearGulf && this.imagery.uniforms.uEarthRegionOn.value > 0.5 && this.imagery.uniforms.uEarthRegionView.value > 0;
      const material = regional ? (camDist - R - (this.terrain?.maxHeight ?? 0) >= 16000 ? variants.far : variants.detail) : variants.base;
      if (material !== variants.active) {
        this.quadtree?.setMaterials(material, variants.ocean);
        variants.active = material;
      }
    }

    this.surfaceFeatures?.update(this.scatterOffset.set(bx, by, bz), this.rotQ, cam.position, time, u.uSunDir.value);
    this.scatter?.update([camBFx, camBFy, camBFz], this.scatterOffset.set(bx, by, bz), this.rotQ);

    const vh = p.viewportHeight ?? 1080;
    const sf = screenSpaceFactor(cam, vh);
    const projR = (R / Math.max(camDist, R * 1.0001)) * (p.switchViewportHeight === undefined ? sf : screenSpaceFactor(cam, p.switchViewportHeight));
    this.stats.projectedRadiusPx = projR;
    this.stats.altitude = camDist - R;

    const placeWhole = (m: THREE.Object3D, scale: number) => {
      m.position.set(bx, by, bz);
      m.quaternion.copy(this.rotQ);
      m.scale.setScalar(scale);
      m.updateMatrix();
    };

    if (this.sunMesh) {
      placeWhole(this.sunMesh, R);
      const sm = this.sunMesh.material as THREE.ShaderMaterial;
      sm.uniforms.uTime.value = u.uTime.value;
      // Resolve photosphere detail when approaching the Sun; retain bright HDR radiance at a distance.
      const close = 1 - THREE.MathUtils.smoothstep(camDist / R, 6, 30);
      sm.uniforms.uIntensity.value = THREE.MathUtils.lerp(this.sunRadiance, 1.7, close);
    }
    if (this.sky) placeWhole(this.sky, Ra * 1.002);
    if (this.clouds) {
      // Earth bakes from real cloud imagery once it has loaded (or failed: the synoptic model then).
      const sourceReady = !this.imagery || this.imagery.cloudSourceSettled;
      if (this.cloudMap && !this.cloudMap.done && this.bakeRenderer && sourceReady) {
        if (!this.cloudSourceBound) { this.cloudMap.setSource(this.imagery?.cloudSource ?? null); this.cloudSourceBound = true; }
        if (this.cloudMap.step(this.bakeRenderer)) {
          u.uCloudShell.value = this.cloudRadius;
          this.bakeRenderer = null;
          this.imagery?.releaseCloudSource();
        }
      }
      // Body-fixed weather keeps marine decks aligned with their coastlines.
      u.uCloudRot.value.copy(this.cloudRotM.copy(this.rotM).transpose());
      placeWhole(this.clouds, this.cloudRadius * 1.01);
      const cm = this.clouds.material as THREE.ShaderMaterial;
      cm.uniforms.uCamCCloud.value = (camDist - this.cloudRadius) * (camDist + this.cloudRadius);
    }
    if (this.rings) placeWhole(this.rings, 1);
    this.ringParticles?.update(camBF, u.uPlanetCenter.value, this.rotQ);
    // The nearest geometry is now metres away even though the planet's surface is thousands of km away.
    if (this.ringParticles?.group.visible && cam.near > 0.1) {
      cam.near = 0.1;
      cam.updateProjectionMatrix();
    }
    for (const effect of this.effects) placeWhole(effect, R * effect.userData.extent);

    if (this.kind === 'gas') {
      placeWhole(this.farSphere!, R);
      this.stats.mode = 'far';
      return;
    }
    if (this.kind !== 'solid') return;

    // Far LOD texture bake (once, lazily).
    if (this.terrain && !this.bakeRequested && this.pool) {
      this.bakeRequested = true;
      this.surfaceBake = acquireSurfaceBake(this.pool, this.terrainKey, this.quality.bakedTextureWidth);
      this.surfaceBake.promise.then((res) => {
        if (this.disposed) return;
        const tex = res.texture;
        this.farTexture = tex;
        if (this.farMaterial) {
          this.farMaterial.uniforms.uMap.value = tex;
          this.farMaterial.uniforms.uHasMap.value = 1;
          this.farMaterial.uniforms.uHRange.value.set(res.minHeight, res.maxHeight);
        }
      }).catch(() => { if (!this.disposed) { this.surfaceBake?.release(); this.surfaceBake = undefined; this.bakeRequested = false; } });
    }

    // The far-LOD bake lives on the GPU once drawn: drop its CPU pixels (32 MB per body at Ultra).
    if (this.farTexture?.source.dataReady && this.hostRenderer) releasePixels(this.farTexture, this.hostRenderer);

    const qt = this.quadtree;
    // Flat, colorful moons need texture resolution, not geometric refinement: retain the bake longer.
    const colorDominated = this.body.id === 'io' || this.body.id === 'europa';
    const wantNear = !!qt && wantsTerrainLod(R, camDist, projR, this.quality.bakedTextureWidth, colorDominated);
    this.wantNear = wantNear;
    if (qt && wantNear) {
      this.tmpM4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.tmpM4);
      const e = this.rotM.elements;
      const inFrustum = (x: number, y: number, z: number, r: number) => {
        this.tmpS.center.set(bx + e[0] * x + e[3] * y + e[6] * z, by + e[1] * x + e[4] * y + e[7] * z, bz + e[2] * x + e[5] * y + e[8] * z);
        this.tmpS.radius = r;
        return this.frustum.intersectsSphere(this.tmpS);
      };
      // Camera orientation in the body frame: the frustum test is unchanged while it and the position hold still.
      const q = this.viewQuat.copy(inv).multiply(cam.getWorldQuaternion(this.camQuat));
      const v = this.viewKey, pm = cam.projectionMatrix.elements;
      v[0] = camBFx; v[1] = camBFy; v[2] = camBFz; v[3] = q.x; v[4] = q.y; v[5] = q.z; v[6] = q.w; v[7] = sf; v[8] = pm[0]; v[9] = pm[5]; v[10] = pm[10];
      qt.select({ camBF: { x: camBFx, y: camBFy, z: camBFz }, screenFactor: sf, maxScreenError: this.quality.terrain.maxScreenError, inFrustum, frame: this.frame }, v);
      qt.pump();
      if (qt.rootsReady) {
        qt.place(bx, by, bz, this.rotQ, this.rotM);
        this.farSphere!.visible = false;
        this.stats.mode = 'near';
      } else {
        qt.hideAll();
        this.farSphere!.visible = true;
        placeWhole(this.farSphere!, R);
        this.stats.mode = 'far';
      }
      qt.evict(this.frame);
      Object.assign(this.stats, { chunks: qt.stats.selected, meshes: qt.stats.meshes, inflight: qt.stats.inflight, queued: qt.stats.queued });
    } else {
      qt?.hideAll();
      if (qt) { qt.pump(); qt.evict(this.frame, true); }
      this.farSphere!.visible = true;
      placeWhole(this.farSphere!, R);
      this.stats.mode = 'far';
    }
    // Earth has a complete opaque terrain/far-sphere surface. Cutouts have a
    // trench floor far above its global minimum. Keep the inner sphere below the
    // lowest terrain AND triangle sag; the visible horizon/negative land remains untouched.
    if (this.sky && this.body.id === 'earth') {
      let angle = 2 * Math.PI / this.quality.sphereSegments;
      if (this.stats.mode === 'near' && qt?.selected.length) {
        let level = Infinity;
        for (const n of qt.selected) level = Math.min(level, n.key.level);
        // Cube-face step incl. diagonal/stretch: a conservative cone, not the mean arc length.
        angle = 4 / (this.quality.terrain.chunkResolution * 2 ** level);
      }
      const inner = skyOcclusionRadius(R, this.terrain?.minHeight ?? 0, angle);
      const mat = this.sky.material as THREE.ShaderMaterial;
      mat.uniforms.uSkyGroundC.value = (camDist - inner) * (camDist + inner);
      // Distant Float32 ray discriminants lose precision; those tiny discs do
      // not warrant this shortcut. Keep their original atmospheric shader.
      mat.uniforms.uSkyGroundEnabled.value = camDist > inner && camDist < 2 * R ? 1 : 0;
    }
  }

  /** Solid surface is ready for control. Cosmetic scatter continues streaming independently. */
  get surfaceReady(): boolean {
    if (this.kind !== 'solid') return true;
    const bakeDone = (!this.terrain || !!this.farTexture) && this.imageryIdle;
    if (!bakeDone) return false;
    // Far mode is final only when near terrain is not wanted; otherwise it is the stand-in shown while roots build.
    return !this.quadtree || (this.wantNear ? this.stats.mode === 'near' && this.quadtree.idle : true);
  }

  /** Fully settled, including decoration (screenshots/tests can still wait for this). */
  get idle(): boolean {
    return this.surfaceReady && (!this.scatter?.group.visible || this.scatter.idle);
  }

  /**
   * Some imagery is on screen (the bundled level); higher-resolution packs stream in afterwards and never hold the
   * loading screen. Bounded in case even the bundled level is slow.
   */
  private get imageryIdle(): boolean {
    if (!this.imagery || this.imagery.presentable) return true;
    return typeof performance !== 'undefined' && performance.now() - this.imageryStart > 4000;
  }

  /** Terrain height under a body-fixed unit direction (m), 0 if no terrain. */
  heightAt(x: number, y: number, z: number): number {
    return this.terrain ? this.terrain.heightAt(x, y, z) : 0;
  }

  /**
   * CPU estimate of how much sunlight reaches `pointSim` (float64 inertial): 0 if the body occludes
   * the sun, else per-channel atmospheric transmittance. Use for sun glare / lens flare intensity.
   */
  sunVisibility(pointSim: Vec3, bodyPosition: Vec3, sunPosition: Vec3): [number, number, number] {
    const R = this.body.radius;
    const ox = pointSim.x - bodyPosition.x, oy = pointSim.y - bodyPosition.y, oz = pointSim.z - bodyPosition.z;
    let dx = sunPosition.x - pointSim.x, dy = sunPosition.y - pointSim.y, dz = sunPosition.z - pointSim.z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    const b = ox * dx + oy * dy + oz * dz;
    const r = Math.sqrt(ox * ox + oy * oy + oz * oz);
    const c = (r - R) * (r + R);
    const disc = b * b - c;
    if (disc > 0 && -b - Math.sqrt(disc) > 0) {
      // Soft edge using closest-approach distance
      const closest = Math.sqrt(Math.max(0, r * r - b * b));
      const soft = Math.min(1, Math.max(0, (closest - R * 0.995) / (R * 0.01)));
      if (soft <= 0) return [0, 0, 0];
    }
    const a = this.atmosphere;
    if (!a || r > a.atmosphereRadius * 1.5) return [1, 1, 1];
    // Integrate optical depth to the top of the atmosphere (16 steps).
    const ca = (r - a.atmosphereRadius) * (r + a.atmosphereRadius);
    const da = b * b - ca;
    if (da <= 0) return [1, 1, 1];
    const t1 = -b + Math.sqrt(da);
    const t0 = Math.max(0, -b - Math.sqrt(da));
    const steps = 16;
    const dt = (t1 - t0) / steps;
    let odR = 0, odM = 0;
    for (let i = 0; i < steps; i++) {
      const t = t0 + (i + 0.5) * dt;
      const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
      const h = Math.max(0, Math.sqrt(px * px + py * py + pz * pz) - R);
      odR += Math.exp(-h / a.rayleighScaleHeight) * dt;
      odM += Math.exp(-h / a.mieScaleHeight) * dt;
    }
    return [0, 1, 2].map((k) => Math.exp(-(a.betaRayleigh[k] * odR + a.betaMieExt[k] * odM))) as [number, number, number];
  }

  setQuality(q: QualitySettings): void {
    // Simplest robust path: callers recreate the PlanetRenderer on quality change.
    this.quality = q;
  }

  /** After a WebGL context restore: stream the Earth imagery again and re-bake the cloud map. */
  private restoreGpuContent(): void {
    if (this.disposed) return;
    this.imagery?.restoreContext();
    if (!this.cloudMap) return;
    this.cloudMap.restart();
    this.cloudSourceBound = false;
    this.bakeRenderer = null; // the cloud mesh sets it again on its next draw
    this.uniforms.uCloudShell.value = 0; // hides the shell until the new bake is complete
    this.imagery?.reloadClouds();
  }

  dispose(): void {
    this.disposed = true;
    this.restoreHook.dispose();
    unregisterPlanetUniforms(this.body.id, this.uniforms);
    lightSources.delete(this);
    this.ringParticles?.dispose();
    this.ringTexture?.dispose();
    this.quadtree?.dispose();
    this.scatter?.dispose();
    this.surfaceFeatures?.dispose();
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    this.lut?.dispose();
    this.cloudMap?.dispose();
    this.imagery?.dispose();
    this.surfaceBake?.release();
    this.root.removeFromParent();
  }
}
