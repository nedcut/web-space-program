import * as THREE from 'three';

/** A single billboard draw for the body catalogue; maneuver sprites remain independently pickable. */
export class BodyIcons {
  readonly mesh: THREE.InstancedMesh;
  private matrix = new THREE.Matrix4();
  private color = new THREE.Color();
  constructor(count: number) {
    const material = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 vUv; varying vec3 vColor;
      void main() {
        vUv = uv; vColor = instanceColor;
        // CPU projection keeps billboard attributes near zero even at astronomical distances.
        gl_Position = instanceMatrix * vec4(position.xy, 0., 1.);
      }`,
      fragmentShader: `varying vec2 vUv; varying vec3 vColor;
      void main() {
        float r = length(vUv - .5);
        float d = abs(r - .30);
        float aa = fwidth(d);
        // Coloured ring over a dark halo and a faint disc: readable on dark space and over bright planets.
        float ring = 1. - smoothstep(.05-aa,.05+aa,d);
        float halo = (1. - smoothstep(.10-aa,.10+aa,d)) * .7;
        float disc = (1. - smoothstep(.30-aa,.30+aa,r)) * .22;
        float alpha = ring + (1. - ring) * max(halo, disc);
        vec3 color = mix(vec3(.01,.02,.04), vColor, ring / max(alpha, 1e-4));
        gl_FragColor = vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 10;
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, this.color.setHex(0xffffff));
  }
  set(index: number, position: THREE.Vector3, width: number, height: number, color: number) {
    this.matrix.makeScale(width, height, 1).setPosition(position.x, position.y, 0);
    this.mesh.setMatrixAt(index, this.matrix);
    this.mesh.setColorAt(index, this.color.setHex(color));
  }
  finish(count: number) {
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
