/** Browser capabilities the 3D scenes cannot run without. Probed once, lazily, with a throwaway context. */
export interface BrowserSupport {
  webgl2: boolean;
  /** Human-readable reason when WebGL 2 is unavailable (browser status message where one is given). */
  reason: string | null;
}

let cached: BrowserSupport | undefined;

export function browserSupport(): BrowserSupport {
  if (cached) return cached;
  let reason: string | null = null;
  try {
    if (typeof WebGL2RenderingContext === 'undefined') reason = 'This browser does not implement WebGL 2.';
    else {
      const canvas = document.createElement('canvas');
      let status = '';
      canvas.addEventListener('webglcontextcreationerror', (e) => { status = (e as WebGLContextEvent).statusMessage; });
      const gl = canvas.getContext('webgl2');
      if (!gl) reason = status.trim() || 'The browser refused to create a WebGL 2 context. Hardware acceleration may be turned off, or the graphics driver is blocklisted.';
      else gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  return cached = { webgl2: !reason, reason };
}

/** Scenes that create a WebGL renderer with no 2D fallback. */
export const SCENES_NEEDING_WEBGL2 = new Set(['editor', 'flight', 'tracking']);
