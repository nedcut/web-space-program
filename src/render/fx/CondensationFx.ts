import * as THREE from 'three';

/** Single thin transonic vapour sheet. Humidity is a visual proxy, supplied by the caller. */
export class CondensationFx {
  readonly object: THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial>;
  private readonly axis = new THREE.Vector3(0,1,0);
  constructor() {
    const geometry = new THREE.ConeGeometry(1,1,32,1,true);
    geometry.translate(0,-.5,0);
    this.object = new THREE.Mesh(geometry,new THREE.ShaderMaterial({
      transparent:true, depthWrite:false, side:THREE.DoubleSide,
      uniforms:{ opacity:{value:0} },
      vertexShader:`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv;
        void main() {
          vUv=uv;
          vec4 mvPosition=modelViewMatrix*vec4(position,1.);
          gl_Position=projectionMatrix*mvPosition;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader:`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float opacity; varying vec2 vUv;
        void main() {
          #include <logdepthbuf_fragment>
          float band=smoothstep(0.,.3,vUv.y)*(1.-smoothstep(.5,1.,vUv.y));
          gl_FragColor=vec4(.8,.86,.95,band*opacity);
        }`,
    }));
    this.object.name='transonic-vapour'; this.object.visible=false;
  }
  update(mach: number, humidity: number, radius: number, airDirection: THREE.Vector3) {
    const strength = Math.exp(-Math.pow((mach-1.02)/.14,2))*humidity;
    this.object.visible=strength>.015;
    this.object.material.uniforms.opacity.value=.22*strength;
    this.object.quaternion.setFromUnitVectors(this.axis,airDirection);
    this.object.scale.set(radius*1.8,radius*3,radius*1.8);
  }
  dispose() {this.object.geometry.dispose();this.object.material.dispose();this.object.removeFromParent();}
}
