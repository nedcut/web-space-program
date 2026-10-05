import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** Small depth-aware blur in metres: avoids precision loss from astronomical camera far planes. */
export class PhotoEffectsPass extends Pass {
  scene: THREE.Scene | null = null;
  camera: THREE.Camera | null = null;
  private depth = new THREE.WebGLRenderTarget(64, 64);
  private depthMaterial = new THREE.ShaderMaterial({
    uniforms: { focus: { value: 20 } },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      varying float viewDepth;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); viewDepth = -mv.z; gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float focus; varying float viewDepth;
      void main() {
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(vec3(clamp(viewDepth / (focus * 2.0), 0.0, 1.0)), 1.0);
      }`,
  });
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null }, depthMap: { value: this.depth.texture },
    resolution: { value: new THREE.Vector2(64, 64) }, dof: { value: 0 }, vignette: { value: 0.25 }, grain: { value: 0 }, letterbox: { value: 0 },
  };
  private material = new THREE.ShaderMaterial({ uniforms: this.uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse, depthMap; uniform vec2 resolution; uniform float dof, vignette, grain, letterbox; varying vec2 vUv;
      void main() {
        float blur = abs(texture2D(depthMap,vUv).r - 0.5) * dof * 16.0;
        vec3 c = texture2D(tDiffuse,vUv).rgb * 0.2;
        for(int i=0;i<8;i++){ float a=float(i)*0.785398; c+=texture2D(tDiffuse,clamp(vUv+vec2(cos(a),sin(a))*blur/resolution,0.0,1.0)).rgb*0.1; }
        vec2 p=vUv*2.0-1.0; c *= 1.0-vignette*smoothstep(0.2,1.4,length(p));
        float n=fract(sin(dot(floor(vUv*resolution),vec2(12.9898,78.233)))*43758.5453)-0.5;
        c+=n*grain*0.12;
        if(vUv.y<letterbox || vUv.y>1.0-letterbox) c=vec3(0.0);
        gl_FragColor=vec4(c,1.0);
      }`,
  });
  private quad = new FullScreenQuad(this.material);
  constructor() { super(); this.enabled = false; }
  set focus(value: number) { this.depthMaterial.uniforms.focus.value = value; }
  setSize(width: number, height: number) { this.depth.setSize(width, height); this.uniforms.resolution.value.set(width, height); }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    if (this.scene && this.camera && this.uniforms.dof.value > 0) {
      const override = this.scene.overrideMaterial, background = this.scene.background;
      const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
      try {
        this.scene.overrideMaterial = this.depthMaterial; this.scene.background = null;
        renderer.setClearColor(0xffffff, 1); renderer.setRenderTarget(this.depth); renderer.clear(); renderer.render(this.scene, this.camera);
      } finally { this.scene.overrideMaterial = override; this.scene.background = background; renderer.setClearColor(clear, alpha); }
    }
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer);
  }
  dispose() { this.depth.dispose(); this.depthMaterial.dispose(); this.material.dispose(); this.quad.dispose(); }
}
