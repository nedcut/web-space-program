/* global window */
// Browser eval: set __groundlookProjection to GLSL_EARTH_REGION_UV first.
// Checks the actual Float32 GPU projection against exact spherical coordinates.
(() => {
  const r = window.__preview.pipeline.renderer, gl = r.getContext();
  const input = [], exact = [], R = 637100;
  for (let lat = 10; lat <= 35; lat += 0.25) for (let lon = -100; lon <= -60; lon += 0.25) {
    const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
    input.push(Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a));
    exact.push(lon / 360 + 0.5, 0.5 - lat / 180);
  }
  const program = gl.createProgram(), shaders = [];
  for (const [type, source] of [
    [gl.VERTEX_SHADER, '#version 300 es\nprecision highp float;\nlayout(location=0) in vec3 n; out vec2 uv;\n' + window.__groundlookProjection + '\nvoid main(){uv=earthRegionProjection(normalize(n)); gl_Position=vec4(0,0,0,1);}'],
    [gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;out vec4 c;void main(){c=vec4(1);}'],
  ]) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    gl.attachShader(program, s); shaders.push(s);
  }
  gl.transformFeedbackVaryings(program, ['uv'], gl.INTERLEAVED_ATTRIBS); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  const vao = gl.createVertexArray(), src = gl.createBuffer(), dst = gl.createBuffer(), feedback = gl.createTransformFeedback();
  try {
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, src);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(input), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, dst); gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, exact.length * 4, gl.STREAM_READ);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, dst); gl.useProgram(program);
    gl.enable(gl.RASTERIZER_DISCARD); gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, input.length / 3); gl.endTransformFeedback(); gl.disable(gl.RASTERIZER_DISCARD);
    const result = new Float32Array(exact.length); gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, result);
    let error = 0;
    for (let i = 0; i < result.length; i++) error = Math.max(error, Math.abs(result[i] - exact[i]) * Math.PI * R * (i % 2 ? 1 : 2));
    if (error > 1) throw Error('Regional projection exceeds 1 m: ' + error);
    return { samples: input.length / 3, maxStandardMetres: error, maxRealMetres: error * 10 };
  } finally {
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null); gl.bindVertexArray(null);
    gl.deleteTransformFeedback(feedback); gl.deleteBuffer(src); gl.deleteBuffer(dst); gl.deleteVertexArray(vao);
    gl.deleteProgram(program); shaders.forEach(s => gl.deleteShader(s)); r.resetState();
  }
})()
