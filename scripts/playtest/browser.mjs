// Same diagnostics and functional graphics settings as the maintained smoke suite.
export function browserSetup() {
  if (!localStorage.getItem('wsp.settings.v1')) localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'low', frameRateCap: 30, graphicsProfile: 99, adaptiveQuality: false, shadows: false, bloom: false, clouds: false, scatter: false, renderScale: 0.5, autoSaveInterval: 0 }));
  const fail = message => window.__playtestReport(message);
  const contexts = [], programs = [], disposed = new WeakSet();
  // Check one context's errors and pending shader links; runs before disposal and on every check.
  function check(gl) {
    if (disposed.has(gl)) return;
    if (gl.isContextLost()) fail('Lost GL context');
    const error = gl.getError();
    if (error) fail(`GL error ${error}`);
    for (let i = programs.length - 1; i >= 0; i--) {
      const [owner, program] = programs[i];
      if (owner !== gl) continue;
      programs.splice(i, 1);
      if (gl.isProgram(program) && !gl.getProgramParameter(program, gl.LINK_STATUS)) fail(gl.getProgramInfoLog(program) || 'Shader link failed');
    }
  }
  // three.js deliberately loses contexts on scene disposal. Unexpected losses still fail.
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const get = P.getExtension;
    P.getExtension = function (name) {
      const ext = get.call(this, name);
      if (name === 'WEBGL_lose_context' && ext && !ext.__smokeWrapped) {
        const lose = ext.loseContext.bind(ext);
        ext.loseContext = () => { check(this); disposed.add(this); lose(); };
        ext.__smokeWrapped = true;
      }
      return ext;
    };
  }
  // Production three.js disables shader diagnostics. Check actual link status too.
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const link = P.linkProgram;
    P.linkProgram = function (program) {
      if (!contexts.includes(this)) {
        contexts.push(this);
        this.canvas.addEventListener('webglcontextlost', () => { if (!disposed.has(this)) fail('WebGL context lost'); });
      }
      programs.push([this, program]);
      return link.call(this, program);
    };
  }
  window.__playtestGPU = () => { for (const gl of contexts) check(gl); };
  addEventListener('pagehide', () => window.__playtestGPU());
}
