import * as THREE from 'three';
import { SkyEnvironment, surfaceBounce } from '../../render/core/skyEnv';
import { ShadowMapCache } from '../../render/core/shadowCache';
import { maxDrawingEdge } from '../../render/core/drawingLimits';
import { updateSiteShadow } from '../../render/site/shadows';
import { Starfield } from '../../render/sky/Starfield';
import { SunGlare } from '../../render/sky/SunGlare';
import type { QualitySettings } from '../../render/core/quality';
import type { FlightFx } from '../../render/fx/FlightFx';
import type { Universe } from '../../game/universe';
import type { WorldVessel } from '../../game/world';
import { length, sub, type Vec3 } from '../../util/vec3';

/** Flight lights, sky environment and shadow invalidation; all GPU resources belong to this scene. */
export class FlightLighting {
  private stars: Starfield;
  private glare: SunGlare;
  private skyEnv: SkyEnvironment;
  private readonly envUp = new THREE.Vector3();
  private readonly envBounce: [number, number, number] = [0, 0, 0];
  private sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
  private ambient = new THREE.HemisphereLight(0x8899bb, 0x221a10, 0.12);
  private nightLight = new THREE.DirectionalLight(0xdfe8ff, 0);
  private readonly shadowCache = new ShadowMapCache();
  private readonly sunDirection = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, private universe: Universe, q: QualitySettings) {
    this.stars = new Starfield({ count: q.stars.count, milkyWay: q.stars.milkyWay, seed: 7 });
    this.scene.add(this.stars.group);
    this.glare = new SunGlare();
    this.scene.add(this.glare.mesh);
    this.scene.add(this.sunLight, this.sunLight.target, this.ambient, this.nightLight, this.nightLight.target);
    this.sunLight.castShadow = true;
    const shadowSize = Math.min(q.shadowMapSize || 512, maxDrawingEdge(this.renderer));
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.sunLight.shadow.bias = -0.00002;
    this.sunLight.shadow.normalBias = 0.02;
    // Soft PCF (Vogel disk); three r186 PCFShadowMap honours the radius.
    this.sunLight.shadow.radius = 2.5;

    // Image-based fill light so sunlit-from-behind vessels aren't pitch black. Scaled by air density each frame.
    // Procedural sky/planetshine environment, re-baked as altitude, attitude and sun change.
    this.skyEnv = new SkyEnvironment(this.renderer);
    this.scene.environmentIntensity = 1;
  }

  setQuality(quality: QualitySettings) {
    const size = Math.min(quality.shadowMapSize || 512, maxDrawingEdge(this.renderer));
    if (this.sunLight.shadow.mapSize.x !== size) {
      this.sunLight.shadow.mapSize.set(size, size);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
    }
  }

  invalidate() { this.shadowCache.invalidate(); }

  placeSun(sunDir: Vec3, radius: number, body: string, nearSite: boolean, groundAltitude: number) {
    // Sun light: directional, shadow frustum hugging the active vessel.
    const sd = this.sunDirection.set(sunDir.x, sunDir.y, sunDir.z);
    // Cover the tower, trench and low-sun ground shadows near the launch complex.
    const r = Math.max(nearSite ? 210 : 10, radius * 2.5);
    this.sunLight.position.copy(sd).multiplyScalar(r * 4);
    this.sunLight.target.position.set(0, 0, 0);
    const sc = this.sunLight.shadow.camera as THREE.OrthographicCamera;
    // Depth range reaches well past the vessel so long low-sun shadows on the ground are not clipped; airless
    // descents need the vessel's shadow on the ground from several km up.
    const far = r * 4 + Math.max(r * 8, body === 'earth' ? 1500 : 6000);
    if (sc.right !== r || sc.far !== far) {
      sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.1; sc.far = far;
      sc.updateProjectionMatrix();
      // Biases scale with the shadow texel size (acne-free without peter-panning at any vessel size).
      const texel = (2 * r) / this.sunLight.shadow.mapSize.x;
      this.sunLight.shadow.normalBias = texel * 1.2;
      this.sunLight.shadow.bias = -0.00002;
    }

    // Ground receivers sample the vessel's shadow map only while the ground is within its depth range (orbit
    // frames skip the per-fragment lookup entirely).
    const shadowReachesGround = groundAltitude < sc.far;
    updateSiteShadow(this.sunLight, this.renderer.shadowMap.enabled && shadowReachesGround);
  }

  update(wv: WorldVessel, origin: Vec3, bodyPosition: Vec3, groundAltitude: number, airDensity: number,
    camera: THREE.PerspectiveCamera, eclipse: number, tint: readonly number[], nightVision: boolean, pixelRatio: number, effects: FlightFx) {
    const tmax = Math.max(1e-6, tint[0], tint[1], tint[2]);
    this.sunLight.color.setRGB(tint[0] / tmax, tint[1] / tmax, tint[2] / tmax);
    this.sunLight.intensity = 3.2 * eclipse;
    // Night vision lights what the camera looks at, strongest in full shadow so daylight shading is untouched.
    const dark = nightVision ? 1 - eclipse : 0;
    this.ambient.intensity = 0.12 + 1.4 * dark;
    // Always in the scene (intensity 0 when off): toggling visibility would change the light count and recompile shaders.
    this.nightLight.intensity = 2.2 * dark;
    if (dark > 0) {
      this.nightLight.position.copy(camera.position);
      camera.getWorldDirection(this.nightLight.target.position).add(camera.position);
    }
    // Sky fill: brighter in thick air (scattered skylight), dim in space (planetshine + starlight).
    const airFrac = Math.min(1, airDensity / 1.0);
    effects.lighting(this.sunDirection, camera, this.sunLight.color, this.sunLight.intensity, airFrac);
    const u = this.universe;
    const envBody = u.body(wv.body);
    const envRel = sub(origin, bodyPosition);
    const envDist = Math.max(envBody.radius, length(envRel));
    // Ground bounce from the terrain under the vessel: mid palette albedo on land, the darkest (water) entry over liquid.
    const colors = envBody.surface.colors;
    const terrain = envBody.solidSurface ? u.terrain(wv.body) : null;
    // The surface under the vessel is max(liquid level, terrain): at the liquid level means over liquid.
    const datumAltitude = length(sub(wv.state.position, bodyPosition)) - envBody.radius;
    const liquidLevel = terrain?.liquid?.level ?? 0;
    const overLiquid = !!terrain?.ocean && Math.abs(datumAltitude - groundAltitude - liquidLevel) < 0.01;
    const bounce = envBody.solidSurface ? surfaceBounce({
      albedo: (overLiquid ? colors[0] : colors[1] ?? colors[0]) ?? [0.3, 0.3, 0.3],
      altitude: datumAltitude, radius: envBody.radius, daylight: eclipse,
      sunColor: [this.sunLight.color.r, this.sunLight.color.g, this.sunLight.color.b], airless: !envBody.atmosphere,
    }, this.envBounce) : undefined;
    this.scene.environment = this.skyEnv.update(
      {
        up: this.envUp.set(envRel.x, envRel.y, envRel.z).normalize(),
        sun: this.sunDirection,
        air: airFrac,
        daylight: eclipse,
        ground: envBody.surface.colors[0] ?? [0.3, 0.3, 0.3],
        skyTint: envBody.atmosphere?.tint,
        bodyAngle: Math.asin(Math.min(1, envBody.radius / envDist)),
        bounce,
      },
      performance.now(),
    );
    this.scene.environmentIntensity = 0.85 + 0.35 * airFrac;
    this.stars.update(camera, pixelRatio);
    this.glare.update(camera, this.sunDirection, eclipse);
  }

  updateShadows() { this.shadowCache.update(this.scene, this.sunLight, this.renderer.shadowMap.enabled); }

  dispose() {
    this.stars.dispose();
    this.glare.dispose();
    this.skyEnv.dispose();
    this.scene.environment = null;
  }
}
