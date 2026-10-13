import * as THREE from 'three';
import type { Vec3 } from '../../util/vec3';

/**
 * One draw, bounded storage. GPU ballistic motion and billowing; float64 anchor before upload.
 * A particle is either a round puff or a trail segment: a camera-facing ribbon from its spawn point to a newer
 * node (`segment.xyz`, born `segment.w` s later). Segments chain into a gap-free column at any speed; each end
 * grows and fades with its own age. Smoke is lit by the sun and sky (wrap diffuse, forward scatter, ambient);
 * fire/sparks (growth 0) stay emissive.
 */
export class ParticlePool {
  readonly object: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly anchor = new THREE.Vector3();
  private initialized = false;
  private cursor = 0;
  private trailCursor = 0;
  private readonly burstCapacity: number;
  /** Slots reserved for long-lived trail particles. */
  get trailCapacity() { return this.capacity - this.burstCapacity; }
  private expires = 0;
  /** Dirty spans of the burst and trail regions, uploaded as separate ranges. */
  private readonly dirty = [Infinity, -1, Infinity, -1];
  private readonly attributeNames = ['spawnPosition','velocity','params','color','acceleration','segment','column'] as const;
  private readonly uploadRanges = Array.from({ length: this.attributeNames.length * 2 }, () => ({ start: 0, count: 0 }));
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly params: Float32Array;
  private readonly colors: Float32Array;
  private readonly accelerations: Float32Array;
  private readonly segments: Float32Array;
  private readonly columns: Float32Array;
  constructor(readonly capacity: number) {
    this.burstCapacity=capacity<128 ? capacity : Math.floor(capacity/4);
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);
    this.colors = new Float32Array(capacity * 4);
    this.accelerations = new Float32Array(capacity * 3);
    this.segments = new Float32Array(capacity * 4);
    this.columns = new Float32Array(capacity * 4);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.attributes.position);
    geometry.instanceCount = capacity;
    for (const [name, array, size] of [['spawnPosition', this.positions, 3], ['velocity', this.velocities, 3], ['params', this.params, 4], ['color', this.colors, 4], ['acceleration', this.accelerations, 3], ['segment', this.segments, 4], ['column', this.columns, 4]] as const) {
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    }
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      uniforms: { time: { value: 0 }, groundNormal: { value: new THREE.Vector3(0,1,0) }, groundOffset: { value: -1e20 },
        sunDirection: { value: new THREE.Vector3(0,1,0) }, sunColor: { value: new THREE.Color(1,1,1) },
        skyColor: { value: new THREE.Color(.3,.36,.45) }, glowColor: { value: new THREE.Color(0,0,0) } },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 spawnPosition; attribute vec3 velocity; attribute vec3 acceleration;
        attribute vec4 params; attribute vec4 color; attribute vec4 segment; attribute vec4 column;
        uniform float time; uniform vec3 groundNormal; uniform float groundOffset; uniform vec3 glowColor;
        varying float groundHeight; varying float radius; varying vec3 tint; varying float alpha; varying float hot;
        varying vec2 local; varying float span; varying vec2 axis; varying float phase; varying float erosion; varying vec3 glow;
        varying vec3 cloud; varying float round; varying vec3 segAxis;
        // Columns billow out quickly behind the nozzle, then spread steadily; puffs grow linearly.
        float grow(float size, float age) { return size * mix(.43, .5, column.w) * (1. + column.w * 2.5 * (1. - exp(-age * 1.2)) + max(0.,params.w)*age); }
        float fade(float age) {
          float life = age / max(.001, params.y);
          float body = column.w > .5 ? 1. - life*life : pow(max(0.,1.-life),1.3);
          return step(0.,age) * (1.-step(1.,life)) * body * min(1.,age*8.);
        }
        void main() {
          float ageA = max(0., time - params.x);
          float ageB = ageA - segment.w;
          float valid = step(params.x,time) * (1.-step(1.,ageA/max(.001,params.y))) * step(.001,params.y);
          hot = 1. - step(.001,params.w);
          vec3 p = spawnPosition + velocity * ageA + .5 * acceleration * ageA * ageA;
          vec4 a = modelViewMatrix * vec4(p,1.);
          vec4 b = modelViewMatrix * vec4(p + segment.xyz,1.);
          float rA = grow(params.z, ageA), rB = grow(params.z, max(0.,ageB));
          // Nothing may come closer than ~2 radii to the eye: bounds screen size (overdraw) and avoids eye-crossing quads.
          float nearA = 2.*rA + .5, nearB = 2.*rB + .5;
          if (a.z > -nearA && b.z < -nearB) a.xyz = mix(a.xyz, b.xyz, clamp((a.z + nearA) / (a.z - b.z), 0., 1.));
          if (b.z > -nearB && a.z < -nearA) b.xyz = mix(a.xyz, b.xyz, clamp((-nearB - a.z) / (b.z - a.z), 0., 1.));
          vec2 d = b.xy - a.xy; float len = length(d);
          axis = len > 1e-4 ? d / len : vec2(1.,0.);
          vec2 perp = vec2(-axis.y, axis.x);
          float t = position.x + .5;
          float r = mix(rA, rB, t);
          // Round caps only where the segment is short on screen (puffs, end-on columns). Long column joints overlap by
          // a fraction of a radius and cross-fade linearly, so chained segments read as one seamless body.
          round = 1. - smoothstep(0., 2.*max(rA,rB), len);
          float cap = r * mix(column.w * .6, 1.3, round);
          vec4 mv = vec4(0.,0.,0.,1.);
          float s = mix(-cap, len + cap, t);
          mv.xy = a.xy + axis * s + perp * position.y * 2.6 * r;
          mv.z = mix(a.z, b.z, clamp(s / max(len,1e-4), 0., 1.));
          float eye = smoothstep(2.*r, 4.*r + 1., -mv.z) * step(0., -a.z - nearA*.99) * step(0., -b.z - nearB*.99);
          vec4 eyePosition = mv;
          mv.xyz *= valid;
          gl_Position = projectionMatrix * mv;
          vec3 groundView = (modelViewMatrix * vec4(groundNormal * groundOffset, 1.)).xyz;
          groundHeight = dot(mv.xyz - groundView, normalize((viewMatrix * vec4(groundNormal,0.)).xyz));
          local = vec2(s, position.y * 2.6);
          // Noise lives in the smoke's own frame (billboard point minus air drift): view-independent, continuous across
          // joints, so billows neither swim with the camera nor alias when a column is seen end-on.
          // column.xyz: the node's float64-derived offset from its column's first node (puffs: a random seed).
          float segLength = length(segment.xyz);
          segAxis = segLength > 1e-3 ? segment.xyz / segLength : vec3(0.);
          cloud = column.xyz + transpose(mat3(modelViewMatrix)) * (eyePosition.xyz - modelViewMatrix[3].xyz) - p;
          span = len; radius = r;
          float age = mix(ageA, max(0.,ageB), t);
          float life = age / max(.001, params.y);
          alpha = valid * eye * color.a * mix(fade(ageA), fade(ageB), t);
          // Fire cools from a hot core to orange embers; smoke remains non-emissive apart from engine glow.
          tint = mix(color.rgb, color.rgb * vec3(1.,.16,.025), hot * smoothstep(.1,1.,life));
          glow = glowColor * exp(-age * 8.) * (1. - hot);
          erosion = smoothstep(.15, 1., life);
          phase = (1. - column.w) * (params.x * 17.31 + dot(velocity,vec3(.13,.17,.19)));
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 sunDirection; uniform vec3 sunColor; uniform vec3 skyColor; uniform float time;
        varying float groundHeight; varying float radius; varying vec3 tint; varying float alpha; varying float hot;
        varying vec2 local; varying float span; varying vec2 axis; varying float phase; varying float erosion; varying vec3 glow;
        varying vec3 cloud; varying float round; varying vec3 segAxis;
        // Arithmetic hash (no sin): stable precision on mobile/Apple GPUs and cheap.
        float hash(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        float vnoise(vec3 p) {
          vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
          return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
        }
        void main() {
          if(alpha < .002) discard;
          #include <logdepthbuf_fragment>
          float cap = radius * mix(.6, 1.3, round);
          float beyond = (max(0., -local.x) + max(0., local.x - span)) / max(cap,1e-3);
          vec2 q = vec2(beyond * 1.3 * round, local.y);
          float r2 = dot(q,q); if(r2 > 1.6) discard;
          // Joint cross-fade weights (1 inside the segment, linear across each overlapping end; puffs unaffected).
          float joint = mix(clamp((local.x + cap) / (2.*cap), 0., 1.) * clamp((span + cap - local.x) / (2.*cap), 0., 1.), 1., round);
          // Two octaves of value noise in radii plus a low-frequency bulge, each fading out before it aliases.
          // End-on columns drop the along-axis part of the noise coordinate: the stacked caps then share one coherent
          // ragged silhouette (normalised by radius) instead of layering into bands.
          vec3 c = cloud / max(radius, 1e-3);
          c -= segAxis * dot(c, segAxis) * round * .85;
          vec3 np = c + vec3(phase, phase * .37, time * .03);
          float fw = length(fwidth(np));
          float o1 = 1. - smoothstep(.2, .5, fw * 1.7), o2 = 1. - smoothstep(.2, .5, fw * 3.9);
          float n = .5 + (vnoise(np * 1.7) - .5) * .75 * o1 + (vnoise(np * 3.9 + 7.1) - .5) * .45 * o2;
          float bulge = 1. + (vnoise(np * .45 + 3.3) - .5) * .5 * (1. - smoothstep(.2, .5, fw * .45));
          float body = 1. - r2 / (bulge * bulge);
          // Zero at the quad border whatever the noise does: no hard cuts.
          float window = (1. - smoothstep(.75, 1., beyond)) * (1. - smoothstep(1.05, 1.3, abs(local.y)));
          float density = smoothstep(0., .6 + .3*erosion, body + (n - .5) * .9 - erosion * .3) * window;
          // Fire / sparks: emissive, simple soft disc.
          vec3 color;
          if (hot > .5) color = tint * (.8 + .4*n);
          else {
            vec2 across = vec2(-axis.y, axis.x) * q.y + axis * (local.x < 0. ? -q.x : q.x);
            vec3 normal = normalize(vec3(across * .9, sqrt(max(.05, body)) + .3*(n-.5)));
            float wrap = clamp(dot(normal, sunDirection) * .6 + .4, 0., 1.);
            // Forward scatter: thin edges glow when looking toward the sun.
            float forward = pow(max(0., -sunDirection.z), 6.) * (1. - density) * 1.5;
            color = tint * (sunColor * (wrap * (.65 + .35*n) + forward) + skyColor * (.75 + .25*normal.y)) + glow;
          }
          float softGround = smoothstep(-.1, max(.3,radius*.35), groundHeight);
          // Overlapping joint ends combine to exactly the segment opacity under 'over' blending: 1-(1-a)^w.
          float a = min(.999, alpha * density * softGround);
          gl_FragColor = vec4(color, 1. - pow(1. - a, joint));
        }` });
    this.object = new THREE.Mesh(geometry, material);
    this.object.name = 'flight-particles';
    this.object.frustumCulled = false;
    this.object.visible = false;
    this.object.renderOrder = 8;
  }
  /**
   * `growth` 0 marks an emissive (fire/spark) particle. `opacity` is the puff's peak opacity.
   * `trail` places it in the reserved long-lived region that short bursts never overwrite. Returns the slot.
   */
  emit(position: Vec3, velocity: Vec3, time: number, life: number, size: number, growth: number, color: THREE.Color, acceleration?: Vec3, opacity = .55, trail = life>=30): number {
    if (!this.initialized) { this.anchor.copy(position); this.initialized = true; }
    this.expires = Math.max(this.expires,time+life);
    this.object.visible = true;
    // Short sparks / pad dust must not overwrite the column back to the ground.
    const i = trail && this.capacity>this.burstCapacity
      ? this.burstCapacity + this.trailCursor++ % (this.capacity-this.burstCapacity)
      : this.cursor++ % this.burstCapacity;
    const j = i * 3, k = i * 4;
    this.positions[j] = position.x - this.anchor.x; this.positions[j+1] = position.y - this.anchor.y; this.positions[j+2] = position.z - this.anchor.z;
    this.velocities[j] = velocity.x; this.velocities[j+1] = velocity.y; this.velocities[j+2] = velocity.z;
    this.accelerations[j] = acceleration?.x ?? 0; this.accelerations[j+1] = acceleration?.y ?? 0; this.accelerations[j+2] = acceleration?.z ?? 0;
    this.params[k] = time; this.params[k+1] = life; this.params[k+2] = size; this.params[k+3] = growth;
    this.colors[k] = color.r; this.colors[k+1] = color.g; this.colors[k+2] = color.b; this.colors[k+3] = opacity;
    this.segments[k] = 0; this.segments[k+1] = 0; this.segments[k+2] = 0; this.segments[k+3] = 0;
    this.columns[k] = (i*7919)%4001; this.columns[k+1] = (i*104729)%3989; this.columns[k+2] = (time*977)%3967; this.columns[k+3] = 0;
    this.markDirty(i);
    return i;
  }
  /** Stretch a particle into a segment ending `offset` metres away at a node `delay` s younger (trail heads). */
  setSegment(index: number, offset: Vec3, delay: number, opacity?: number, seed?: Vec3) {
    const k = index * 4;
    if (seed) { this.columns[k] = seed.x; this.columns[k+1] = seed.y; this.columns[k+2] = seed.z; }
    this.columns[k+3] = 1;
    this.segments[k] = offset.x; this.segments[k+1] = offset.y; this.segments[k+2] = offset.z; this.segments[k+3] = delay;
    if (opacity !== undefined) this.colors[k+3] = opacity;
    this.markDirty(index);
  }
  private markDirty(i: number) {
    const r = i < this.burstCapacity ? 0 : 2;
    this.dirty[r] = Math.min(this.dirty[r], i); this.dirty[r+1] = Math.max(this.dirty[r+1], i);
  }

  update(origin: Vec3, time: number, _pixelScale: number) {
    if (!this.initialized) return;
    if (time >= this.expires) { this.object.visible=false; this.initialized=false; return; }
    this.object.visible = true;
    if (this.anchor.distanceToSquared(origin) > 1e8) {
      const x = this.anchor.x-origin.x, y = this.anchor.y-origin.y, z = this.anchor.z-origin.z;
      for (let i=0;i<this.capacity*3;i+=3) { this.positions[i]+=x; this.positions[i+1]+=y; this.positions[i+2]+=z; }
      this.anchor.copy(origin);
      this.dirty[0]=0; this.dirty[1]=this.capacity-1; this.dirty[2]=Infinity; this.dirty[3]=-1;
    }
    if (this.dirty[1] >= 0 || this.dirty[3] >= 0) {
      for (let n=0;n<this.attributeNames.length;n++) {
        const attr=this.object.geometry.attributes[this.attributeNames[n]] as THREE.InstancedBufferAttribute;
        attr.clearUpdateRanges();
        for (let r=0;r<4;r+=2) {
          if (this.dirty[r+1] < 0) continue;
          const range=this.uploadRanges[n*2+r/2]; range.start=this.dirty[r]*attr.itemSize; range.count=(this.dirty[r+1]-this.dirty[r]+1)*attr.itemSize;
          attr.updateRanges.push(range);
        }
        attr.needsUpdate=true;
      }
      this.dirty[0]=this.dirty[2]=Infinity; this.dirty[1]=this.dirty[3]=-1;
    }
    this.object.position.set(this.anchor.x-origin.x,this.anchor.y-origin.y,this.anchor.z-origin.z);
    this.object.material.uniforms.time.value = time;
  }
  clear() {
    this.params.fill(0);
    this.dirty[0]=0; this.dirty[1]=this.capacity-1; this.dirty[2]=Infinity; this.dirty[3]=-1;
    this.object.visible = false; this.initialized = false; this.cursor = 0; this.trailCursor=0; this.expires=0;
  }
  /** Terrain tangent soft intersection; deliberately avoids a second scene/depth pass. */
  ground(position: Vec3, normal: THREE.Vector3, altitude: number) {
    this.object.material.uniforms.groundNormal.value.copy(normal);
    this.object.material.uniforms.groundOffset.value = (position.x-this.anchor.x)*normal.x + (position.y-this.anchor.y)*normal.y + (position.z-this.anchor.z)*normal.z - altitude;
  }
  /**
   * Sun direction (scene space, towards the sun), sun radiance and sky ambient for smoke shading, and the engine
   * glow added to young smoke. The view-space direction is derived per frame from the camera.
   */
  light(sunDirection: THREE.Vector3, camera: THREE.Camera, sun: THREE.Color, sky: THREE.Color, glow: THREE.Color) {
    const u = this.object.material.uniforms;
    u.sunDirection.value.copy(sunDirection).transformDirection(camera.matrixWorldInverse);
    u.sunColor.value.copy(sun); u.skyColor.value.copy(sky); u.glowColor.value.copy(glow);
  }
  dispose() { this.object.geometry.dispose(); this.object.material.dispose(); this.object.removeFromParent(); }
}
