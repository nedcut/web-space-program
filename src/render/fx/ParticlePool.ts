import * as THREE from 'three';
import type { Vec3 } from '../../util/vec3';

/** One draw, bounded storage. GPU ballistic motion and billowing; float64 anchor before upload. */
export class ParticlePool {
  readonly object: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly anchor = new THREE.Vector3();
  private initialized = false;
  private cursor = 0;
  private expires = 0;
  private dirtyStart = Infinity;
  private dirtyEnd = -1;
  private readonly uploadRanges = Array.from({ length: 5 }, () => ({ start: 0, count: 0 }));
  private readonly attributeNames = ['spawnPosition','velocity','params','color','acceleration'] as const;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly params: Float32Array;
  private readonly colors: Float32Array;
  private readonly accelerations: Float32Array;
  constructor(readonly capacity: number) {
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);
    this.colors = new Float32Array(capacity * 3);
    this.accelerations = new Float32Array(capacity * 3);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.attributes.position);
    geometry.setAttribute('uv', quad.attributes.uv);
    geometry.instanceCount = capacity;
    for (const [name, array, size] of [['spawnPosition', this.positions, 3], ['velocity', this.velocities, 3], ['params', this.params, 4], ['color', this.colors, 3], ['acceleration', this.accelerations, 3]] as const) {
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    }
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      uniforms: { time: { value: 0 }, groundNormal: { value: new THREE.Vector3(0,1,0) }, groundOffset: { value: -1e20 } },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 spawnPosition; attribute vec3 velocity; attribute vec3 acceleration;
        attribute vec4 params; attribute vec3 color;
        uniform float time; uniform vec3 groundNormal; uniform float groundOffset;
        varying float groundHeight; varying vec2 groundSlope; varying float radius;
        varying vec3 tint; varying float alpha; varying float hot; varying vec2 vUv;
        varying float phase;
        void main() {
          float age = max(0., time - params.x);
          float life = age / max(.001, params.y);
          float valid = step(params.x,time) * (1.-step(1.,life)) * step(.001,params.y);
          hot = 1. - step(.001,params.w);
          vec3 p = spawnPosition + velocity * age + .5 * acceleration * age * age;
          radius = params.z * (1. + max(0.,params.w)*age) * .5;
          groundHeight = dot(p,groundNormal) - groundOffset;
          groundSlope = (viewMatrix * vec4(groundNormal,0.)).xy;
          vec4 mv = modelViewMatrix * vec4(p,1.);
          mv.xy += position.xy * radius * 2. * valid;
          gl_Position = projectionMatrix * mv;
          alpha = valid * pow(max(0.,1.-life),1.3) * min(1.,age*16.);
          // Fire cools from a hot core to orange embers; smoke remains non-emissive.
          tint = mix(color, color * vec3(1.,.16,.025), hot * smoothstep(.1,1.,life));
          phase = params.x * 17.31 + dot(velocity,vec3(.13,.17,.19)) + age*.3;
          vUv = uv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying vec3 tint; varying float alpha; varying float hot; varying vec2 vUv;
        varying float groundHeight; varying vec2 groundSlope; varying float radius; varying float phase;
        void main() {
          if(alpha < .001) discard;
          #include <logdepthbuf_fragment>
          vec2 p = vUv*2.-1.;
          float r = dot(p,p); if(r>1.) discard;
          // A handful of smooth lobes: no texture upload, ray march, or sparkling hash noise.
          float a = phase + .3*sin(phase);
          mat2 rot = mat2(cos(a),-sin(a),sin(a),cos(a));
          vec2 q = rot*p;
          float billow = sin(q.x*8.+sin(q.y*6.+phase))*sin(q.y*7.-phase);
          float edge = pow(max(0.,1.-r + .14*billow),mix(1.8,1.4,hot));
          float shade = .7 + .3*smoothstep(-.8,.8,p.y) + .12*billow;
          float softGround = smoothstep(-.1, max(.3,radius*.35), groundHeight + dot(p,groundSlope)*radius);
          gl_FragColor = vec4(tint*mix(shade,.8+.2*billow,hot),alpha*edge*.55*softGround);
        }` });
    this.object = new THREE.Mesh(geometry, material);
    this.object.name = 'flight-particles';
    this.object.frustumCulled = false;
    this.object.visible = false;
    this.object.renderOrder = 8;
  }
  emit(position: Vec3, velocity: Vec3, time: number, life: number, size: number, growth: number, color: THREE.Color, acceleration?: Vec3) {
    if (!this.initialized) { this.anchor.copy(position); this.initialized = true; }
    this.expires = Math.max(this.expires,time+life);
    this.object.visible = true;
    const i = this.cursor++ % this.capacity, j = i * 3, k = i * 4;
    this.positions[j] = position.x - this.anchor.x; this.positions[j+1] = position.y - this.anchor.y; this.positions[j+2] = position.z - this.anchor.z;
    this.velocities[j] = velocity.x; this.velocities[j+1] = velocity.y; this.velocities[j+2] = velocity.z;
    this.accelerations[j] = acceleration?.x ?? 0; this.accelerations[j+1] = acceleration?.y ?? 0; this.accelerations[j+2] = acceleration?.z ?? 0;
    this.params[k] = time; this.params[k+1] = life; this.params[k+2] = size; this.params[k+3] = growth;
    this.colors[j] = color.r; this.colors[j+1] = color.g; this.colors[j+2] = color.b;
    this.dirtyStart=Math.min(this.dirtyStart,i); this.dirtyEnd=Math.max(this.dirtyEnd,i);
  }

  update(origin: Vec3, time: number, _pixelScale: number) {
    if (!this.initialized) return;
    if (time >= this.expires) { this.object.visible=false; this.initialized=false; return; }
    this.object.visible = true;
    if (this.anchor.distanceToSquared(origin) > 1e8) {
      const x = this.anchor.x-origin.x, y = this.anchor.y-origin.y, z = this.anchor.z-origin.z;
      for (let i=0;i<this.capacity*3;i+=3) { this.positions[i]+=x; this.positions[i+1]+=y; this.positions[i+2]+=z; }
      this.anchor.copy(origin);
      this.dirtyStart=0; this.dirtyEnd=this.capacity-1;
    }
    if (this.dirtyEnd >= 0) {
      for (let n=0;n<this.attributeNames.length;n++) {
        const attr=this.object.geometry.attributes[this.attributeNames[n]] as THREE.InstancedBufferAttribute;
        const range=this.uploadRanges[n]; range.start=this.dirtyStart*attr.itemSize; range.count=(this.dirtyEnd-this.dirtyStart+1)*attr.itemSize;
        attr.clearUpdateRanges(); attr.updateRanges.push(range); attr.needsUpdate=true;
      }
      this.dirtyStart=Infinity; this.dirtyEnd=-1;
    }
    this.object.position.set(this.anchor.x-origin.x,this.anchor.y-origin.y,this.anchor.z-origin.z);
    this.object.material.uniforms.time.value = time;
  }
  clear() {
    this.params.fill(0);
    this.dirtyStart=0; this.dirtyEnd=this.capacity-1;
    this.object.visible = false; this.initialized = false; this.cursor = 0; this.expires=0;
  }
  /** Terrain tangent soft intersection; deliberately avoids a second scene/depth pass. */
  ground(position: Vec3, normal: THREE.Vector3, altitude: number) {
    this.object.material.uniforms.groundNormal.value.copy(normal);
    this.object.material.uniforms.groundOffset.value = (position.x-this.anchor.x)*normal.x + (position.y-this.anchor.y)*normal.y + (position.z-this.anchor.z)*normal.z - altitude;
  }
  dispose() { this.object.geometry.dispose(); this.object.material.dispose(); this.object.removeFromParent(); }
}
