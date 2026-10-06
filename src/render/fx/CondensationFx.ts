import * as THREE from 'three';

/** Single thin transonic vapour sheet. Humidity is a visual proxy, supplied by the caller. */
export class CondensationFx {
  readonly object: THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial>;
  private readonly axis = new THREE.Vector3(0,1,0);
  constructor() {
    const geometry = new THREE.ConeGeometry(1,1,32,1,true);
    geometry.translate(0,-.5,0);
    this.object = new THREE.Mesh(geometry,new THREE.ShaderMaterial({
      transparent:true, depthWrite:false, side:THREE.FrontSide,
      uniforms:{ opacity:{value:0} },
      vertexShader:`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
        void main() {
          vUv=uv;
          vec4 mvPosition=modelViewMatrix*vec4(position,1.);
          vNormal=normalMatrix*normal; vView=-mvPosition.xyz;
          gl_Position=projectionMatrix*mvPosition;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader:`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float opacity; varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
        void main() {
          #include <logdepthbuf_fragment>
          float ripple=.025*sin(vUv.x*83.+sin(vUv.x*37.)*2.);
          float y=vUv.y+ripple;
          float band=smoothstep(.05,.4,y)*(1.-smoothstep(.45,.9,y));
          float softEdge=smoothstep(0.,.45,abs(dot(normalize(vNormal),normalize(vView))));
          gl_FragColor=vec4(.8,.86,.95,band*opacity*softEdge);
        }`,
    }));
    this.object.name='transonic-vapour'; this.object.visible=false;
  }
  update(mach: number, humidity: number, radius: number, airDirection: THREE.Vector3) {
    const strength = Math.exp(-Math.pow((mach-1.02)/.14,2))*humidity;
    this.object.visible=strength>.015;
    this.object.material.uniforms.opacity.value=.16*strength;
    this.object.quaternion.setFromUnitVectors(this.axis,airDirection);
    this.object.scale.set(radius*1.8,radius*3,radius*1.8);
  }
  dispose() {this.object.geometry.dispose();this.object.material.dispose();this.object.removeFromParent();}
}
