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
        float alpha = 1. - smoothstep(.045-aa,.045+aa,d);
        gl_FragColor = vec4(vColor,alpha);
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
