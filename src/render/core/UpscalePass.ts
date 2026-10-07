import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Edge-adaptive spatial upscale + contrast-limited sharpening in one full-resolution pass (final display pass).
 *
 * The scene, bloom, tone mapping and SMAA run at a reduced internal resolution; this pass reconstructs device
 * resolution from the tone-mapped, antialiased image. Per output pixel it loads the 12 source texels around the
 * sample point (the 2×2 bilinear footprint plus its 8 outer neighbours):
 *
 *         b c
 *       e f g h
 *       i j k l
 *         n o
 *
 * 1. Edge analysis: at each of f, g, j, k a central-difference luma gradient gives a local edge direction, and the
 *    ratio of the central difference to the larger one-sided difference measures how "edge-like" (a clean ramp)
 *    rather than "feature-like" (a peak, noise) the neighbourhood is. Both are blended with bilinear weights.
 * 2. Reconstruction: a windowed, Lanczos-2-like polynomial kernel is stretched along the edge and narrowed across
 *    it (more so the more edge-like), so edges are reconstructed without bilinear stair blur; the window tightens on
 *    edges for a sharper result. The weighted sum is clamped to the 2×2 footprint's range (no ringing).
 * 3. Sharpening: each footprint texel is sharpened at source resolution with a 5-tap cross kernel whose negative
 *    lobe is limited per pixel so no channel can clip (contrast-adaptive), reusing the taps already loaded. The
 *    detail it adds is interpolated bilinearly onto the reconstruction and the result clamped to the sharpened range.
 *
 * Footprints whose luma range is below ~2/255 per channel take a bilinear early-out: there is no edge to orient
 * and the sharpening would change them by less than a code value. This removes most of the cost over sky,
 * space and smooth terrain shading.
 *
 * Inputs are display-referred (after tone mapping and sRGB encoding), where luma differences match perception.
 * The algorithm follows the published structure of edge-adaptive spatial upscalers; the code is original.
 */
export class UpscalePass extends Pass {
  readonly uniforms = {
    tInput: { value: null as THREE.Texture | null },
    /** Source texels per output pixel (input size / output size). */
    uScale: { value: new THREE.Vector2(1, 1) },
    /** 0 = no sharpening, 1 = strongest. */
    uSharpness: { value: 0.5 },
    /** Footprint luma range (0–2 scale) below which the pixel is interpolated bilinearly. */
    uFlat: { value: 4 / 255 },
  };
  private material = new THREE.ShaderMaterial({
    name: 'EdgeUpscale',
    glslVersion: THREE.GLSL3,
    uniforms: this.uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      // Colour/weight math in mediump (fp16 on Apple and mobile GPUs: twice the ALU rate); coordinates stay highp.
      precision mediump float;
      precision highp int;
      uniform highp sampler2D tInput;
      uniform highp vec2 uScale;
      uniform float uSharpness;
      uniform float uFlat;
      out vec4 outColor;

      ivec2 gMax;
      vec3 tap(ivec2 p) { return texelFetch(tInput, clamp(p, ivec2(0), gMax), 0).rgb; }
      float luma(vec3 c) { return 0.5 * c.r + c.g + 0.5 * c.b; }

      // One footprint corner's edge vote: centre C, horizontal neighbours W/E, vertical N/S, bilinear weight w.
      void edgeVote(float w, float n, float wl, float c, float e, float s, inout vec2 dir, inout float len) {
        float dx = e - wl;
        float lx = clamp(abs(dx) / max(max(abs(e - c), abs(c - wl)), 1e-4), 0.0, 1.0);
        float dy = s - n;
        float ly = clamp(abs(dy) / max(max(abs(s - c), abs(c - n)), 1e-4), 0.0, 1.0);
        dir += vec2(dx, dy) * w;
        len += (lx * lx + ly * ly) * w;
      }

      // Windowed kernel at offset v from the sample point, rotated into the edge frame and scaled.
      void kernel(vec3 col, vec2 v, vec2 dir, vec2 len2, float lob, float clp, inout vec3 acc, inout float wsum) {
        vec2 r = vec2(dot(v, dir), dot(v, vec2(-dir.y, dir.x))) * len2;
        float d2 = min(dot(r, r), clp);
        float wb = 0.4 * d2 - 1.0;
        float wa = lob * d2 - 1.0;
        wb *= wb; wa *= wa;
        float w = (1.5625 * wb - 0.5625) * wa;
        acc += col * w; wsum += w;
      }

      // Contrast-limited cross sharpen of C with neighbours N, W, E, S (source resolution).
      vec3 sharpen(vec3 c, vec3 n, vec3 w, vec3 e, vec3 s, float amount) {
        vec3 mn = min(min(n, w), min(e, s));
        vec3 mx = max(max(n, w), max(e, s));
        vec3 hitMin = min(mn, c) / max(4.0 * mx, vec3(1e-4));
        vec3 hitMax = (1.0 - max(mx, c)) / min(4.0 * mn - 4.0, vec3(-1e-4));
        vec3 l3 = max(-hitMin, hitMax);
        float lobe = max(-0.1875, min(max(l3.r, max(l3.g, l3.b)), 0.0)) * amount;
        return (lobe * (n + w + e + s) + c) / (4.0 * lobe + 1.0);
      }

      void main() {
        gMax = textureSize(tInput, 0) - 1;
        highp vec2 pp = gl_FragCoord.xy * uScale - 0.5;
        highp vec2 fp = floor(pp);
        vec2 t = pp - fp;
        ivec2 p = ivec2(fp);
        vec3 f = tap(p), g = tap(p + ivec2(1, 0)), j = tap(p + ivec2(0, 1)), k = tap(p + ivec2(1, 1));
        vec4 bw = vec4((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y); // f g j k
        float lf = luma(f), lg = luma(g), lj = luma(j), lk = luma(k);
        // Flat footprint (sky, space, smooth gradients): no edge to orient and nothing to sharpen — plain bilinear.
        if (max(max(lf, lg), max(lj, lk)) - min(min(lf, lg), min(lj, lk)) < uFlat) {
          outColor = vec4(f * bw.x + g * bw.y + j * bw.z + k * bw.w, 1.0);
          return;
        }
        vec3 b = tap(p + ivec2(0, -1)), c = tap(p + ivec2(1, -1));
        vec3 e = tap(p + ivec2(-1, 0)), h = tap(p + ivec2(2, 0));
        vec3 i = tap(p + ivec2(-1, 1)), l = tap(p + ivec2(2, 1));
        vec3 n = tap(p + ivec2(0, 2)), o = tap(p + ivec2(1, 2));
        float lb = luma(b), lc = luma(c), le = luma(e), lh = luma(h);
        float li = luma(i), ll = luma(l), ln = luma(n), lo = luma(o);
        vec2 dir = vec2(0.0);
        float len = 0.0;
        edgeVote(bw.x, lb, le, lf, lg, lj, dir, len);
        edgeVote(bw.y, lc, lf, lg, lh, lk, dir, len);
        edgeVote(bw.z, lf, li, lj, lk, ln, dir, len);
        edgeVote(bw.w, lg, lj, lk, ll, lo, dir, len);

        float d2 = dot(dir, dir);
        dir = d2 < 1e-4 ? vec2(1.0, 0.0) : dir * inversesqrt(d2);
        len *= 0.5; len *= len;
        float stretch = 1.0 / max(abs(dir.x), abs(dir.y));
        vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
        float lob = 0.5 - 0.29 * len;
        float clp = 1.0 / lob;

        vec3 acc = vec3(0.0); float wsum = 0.0;
        kernel(b, vec2(0.0, -1.0) - t, dir, len2, lob, clp, acc, wsum);
        kernel(c, vec2(1.0, -1.0) - t, dir, len2, lob, clp, acc, wsum);
        kernel(e, vec2(-1.0, 0.0) - t, dir, len2, lob, clp, acc, wsum);
        kernel(f, vec2(0.0, 0.0) - t, dir, len2, lob, clp, acc, wsum);
        kernel(g, vec2(1.0, 0.0) - t, dir, len2, lob, clp, acc, wsum);
        kernel(h, vec2(2.0, 0.0) - t, dir, len2, lob, clp, acc, wsum);
        kernel(i, vec2(-1.0, 1.0) - t, dir, len2, lob, clp, acc, wsum);
        kernel(j, vec2(0.0, 1.0) - t, dir, len2, lob, clp, acc, wsum);
        kernel(k, vec2(1.0, 1.0) - t, dir, len2, lob, clp, acc, wsum);
        kernel(l, vec2(2.0, 1.0) - t, dir, len2, lob, clp, acc, wsum);
        kernel(n, vec2(0.0, 2.0) - t, dir, len2, lob, clp, acc, wsum);
        kernel(o, vec2(1.0, 2.0) - t, dir, len2, lob, clp, acc, wsum);
        vec3 lo4 = min(min(f, g), min(j, k));
        vec3 hi4 = max(max(f, g), max(j, k));
        vec3 col = clamp(acc / max(wsum, 1e-4), lo4, hi4);

        if (uSharpness > 0.0) {
          vec3 fs = sharpen(f, b, e, g, j, uSharpness);
          vec3 gs = sharpen(g, c, f, h, k, uSharpness);
          vec3 js = sharpen(j, f, i, k, n, uSharpness);
          vec3 ks = sharpen(k, g, j, l, o, uSharpness);
          vec3 detail = bw.x * (fs - f) + bw.y * (gs - g) + bw.z * (js - j) + bw.w * (ks - k);
          col = clamp(col + detail, min(lo4, min(min(fs, gs), min(js, ks))), max(hi4, max(max(fs, gs), max(js, ks))));
        }
        outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }`,
  });
  private quad = new FullScreenQuad(this.material);
  private readonly size = new THREE.Vector2();

  constructor() {
    super();
    this.needsSwap = false;
  }

  set sharpness(v: number) { this.uniforms.uSharpness.value = v; }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const out = renderer.getDrawingBufferSize(this.size);
    this.uniforms.tInput.value = readBuffer.texture;
    this.uniforms.uScale.value.set(readBuffer.width / Math.max(1, out.x), readBuffer.height / Math.max(1, out.y));
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
  }

  dispose() { this.material.dispose(); this.quad.dispose(); }
}
