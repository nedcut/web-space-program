import * as THREE from 'three';
import type { Vec3 } from '../../util/vec3';

/** Fixed storage; ballistic motion, expansion and fading run on the GPU. Positions are anchor-relative. */
export class ParticlePool {
  readonly object: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly anchor = new THREE.Vector3();
  private initialized = false;
  private cursor = 0;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly params: Float32Array;
  private readonly colors: Float32Array;
  constructor(readonly capacity: number) {
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);
    this.colors = new Float32Array(capacity * 3);
    const geometry = new THREE.BufferGeometry();
    for (const [name, array, size] of [['position', this.positions, 3], ['velocity', this.velocities, 3], ['params', this.params, 4], ['color', this.colors, 3]] as const) {
      geometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    }
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { time: { value: 0 }, pixelScale: { value: 500 }, groundNormal: { value: new THREE.Vector3(0,1,0) }, groundOffset: { value: -1e20 } },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 velocity; attribute vec4 params; attribute vec3 color;
        uniform float time; uniform float pixelScale;
        uniform vec3 groundNormal; uniform float groundOffset;
        varying float groundHeight; varying vec2 groundSlope; varying float radius;
        varying vec3 tint; varying float alpha; varying float hot;
        void main() {
          float age = time - params.x;
          float life = age / max(.001, params.y);
          float valid = step(0.,age) * (1.-step(1.,life)) * step(.001,params.y);
          hot = step(params.w,0.);
          vec3 p = position + velocity * age;
          radius = params.z * (1. + max(0.,params.w)*age) * .5;
          groundHeight = dot(p,groundNormal) - groundOffset;
          groundSlope = (viewMatrix * vec4(groundNormal,0.)).xy;
          vec4 mv = modelViewMatrix * vec4(p,1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = valid * clamp(params.z * (1. + max(0.,params.w)*age) * pixelScale / max(1.,-mv.z), 1., 160.);
          alpha = valid * pow(max(0.,1.-life),1.4) * min(1.,age*12.);
          tint = color;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying vec3 tint; varying float alpha; varying float hot;
        varying float groundHeight; varying vec2 groundSlope; varying float radius;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p = gl_PointCoord*2.-1.;
          float r = dot(p,p); if(r>1.) discard;
          float edge = pow(1.-r, mix(2.,4.,hot));
          float cloud = .8 + .2*sin(p.x*15.+sin(p.y*13.));
          // Analytic soft intersection against the local terrain tangent plane.
          float softGround = smoothstep(-.1, max(.5,radius*.4), groundHeight + dot(vec2(p.x,-p.y),groundSlope)*radius);
          gl_FragColor = vec4(tint,alpha*edge*cloud*.65*softGround);
        }` });
    this.object = new THREE.Points(geometry, material);
    this.object.frustumCulled = false;
    this.object.visible = false;
  }
  emit(position: Vec3, velocity: Vec3, time: number, life: number, size: number, growth: number, color: THREE.Color) {
    if (!this.initialized) { this.anchor.copy(position); this.initialized = true; }
    this.object.visible = true;
    const i = this.cursor++ % this.capacity, j = i * 3, k = i * 4;
    this.positions[j] = position.x - this.anchor.x; this.positions[j+1] = position.y - this.anchor.y; this.positions[j+2] = position.z - this.anchor.z;
    this.velocities[j] = velocity.x; this.velocities[j+1] = velocity.y; this.velocities[j+2] = velocity.z;
    this.params[k] = time; this.params[k+1] = life; this.params[k+2] = size; this.params[k+3] = growth;
    this.colors[j] = color.r; this.colors[j+1] = color.g; this.colors[j+2] = color.b;
    this.object.geometry.attributes.position.needsUpdate = true;
    this.object.geometry.attributes.velocity.needsUpdate = true;
    this.object.geometry.attributes.params.needsUpdate = true;
    this.object.geometry.attributes.color.needsUpdate = true;
  }
  update(origin: Vec3, time: number, pixelScale: number) {
    if (!this.initialized) return;
    if (this.initialized && this.anchor.distanceToSquared(origin) > 1e8) {
      const x = this.anchor.x-origin.x, y = this.anchor.y-origin.y, z = this.anchor.z-origin.z;
      for (let i=0;i<this.capacity*3;i+=3) { this.positions[i]+=x; this.positions[i+1]+=y; this.positions[i+2]+=z; }
      this.anchor.copy(origin); this.object.geometry.attributes.position.needsUpdate = true;
    }
    this.object.position.set(this.anchor.x-origin.x,this.anchor.y-origin.y,this.anchor.z-origin.z);
    this.object.material.uniforms.time.value = time;
    this.object.material.uniforms.pixelScale.value = pixelScale;
  }
  clear() {
    this.params.fill(0); this.object.geometry.attributes.params.needsUpdate = true;
    this.object.visible = false; this.initialized = false; this.cursor = 0;
  }
  /** Cheap terrain soft particles; no second scene/depth pass on laptop presets. */
  ground(position: Vec3, normal: THREE.Vector3, altitude: number) {
    this.object.material.uniforms.groundNormal.value.copy(normal);
    this.object.material.uniforms.groundOffset.value = (position.x-this.anchor.x)*normal.x + (position.y-this.anchor.y)*normal.y + (position.z-this.anchor.z)*normal.z - altitude;
  }
  dispose() { this.object.geometry.dispose(); this.object.material.dispose(); this.object.removeFromParent(); }
}
