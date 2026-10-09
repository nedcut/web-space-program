import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ArrayUniformCache } from '../src/render/core/uniformCache';

/** three's uniform tree shape: PureArrayUniform (type/size/setValue), SingleUniform (no size), StructuredUniform (seq). */
function fakeProgram() {
  const mat4Array = { id: 'directionalShadowMatrix', type: 0x8b5c, size: 2, setValue: vi.fn() };
  const floatArray = { id: 'gaussianWeights', type: 0x1406, size: 3, setValue: vi.fn() };
  const intArray = { id: 'flags', type: 0x1404, size: 2, setValue: vi.fn() };
  const single = { id: 'roughness', type: 0x1406, setValue: vi.fn() };
  const tree = { seq: [mat4Array, { seq: [floatArray] }, intArray, single] };
  const getUniforms = vi.fn(() => tree);
  return { program: { getUniforms }, mat4Array, floatArray, intArray, single, getUniforms };
}

it('skips re-uploading unchanged float and matrix arrays, per program', () => {
  const p = fakeProgram();
  const uploadMat = p.mat4Array.setValue, uploadFloat = p.floatArray.setValue;
  const cache = new ArrayUniformCache();
  cache.sync([p.program]);
  expect(p.getUniforms).not.toHaveBeenCalled(); // wrapped lazily: never queried before three uses it
  p.program.getUniforms();
  const m = [new THREE.Matrix4().makeTranslation(1, 2, 3), new THREE.Matrix4()];
  const gl = {};
  p.mat4Array.setValue(gl, m);
  p.mat4Array.setValue(gl, [m[0].clone(), m[1].clone()]);
  expect(uploadMat).toHaveBeenCalledTimes(1);
  m[1].makeScale(2, 2, 2);
  p.mat4Array.setValue(gl, m);
  expect(uploadMat).toHaveBeenCalledTimes(2);

  p.floatArray.setValue(gl, [0.25, 0.5, 0.25]);
  p.floatArray.setValue(gl, new Float32Array([0.25, 0.5, 0.25]));
  expect(uploadFloat).toHaveBeenCalledTimes(1);
  p.floatArray.setValue(gl, [0.25, 0.5, 0.26]);
  expect(uploadFloat).toHaveBeenCalledTimes(2);
  // An unexpected shape is uploaded as before and invalidates the cache.
  p.floatArray.setValue(gl, [1, 2]);
  p.floatArray.setValue(gl, [0.25, 0.5, 0.26]);
  expect(uploadFloat).toHaveBeenCalledTimes(4);
});

it('leaves integer arrays and single uniforms to three', () => {
  const p = fakeProgram();
  const ints = p.intArray.setValue, single = p.single.setValue;
  new ArrayUniformCache().sync([p.program]);
  p.program.getUniforms();
  expect(p.intArray.setValue).toBe(ints);
  expect(p.single.setValue).toBe(single);
});

it('wraps each program once, including programs added later', () => {
  const a = fakeProgram(), b = fakeProgram();
  const uploadA = a.floatArray.setValue, uploadB = b.floatArray.setValue;
  const cache = new ArrayUniformCache();
  const programs = [a.program];
  cache.sync(programs);
  programs.push(b.program);
  cache.sync(programs);
  cache.sync(programs);
  for (let i = 0; i < 3; i++) { a.program.getUniforms(); b.program.getUniforms(); }
  a.floatArray.setValue({}, [1, 2, 3]);
  a.floatArray.setValue({}, [1, 2, 3]);
  b.floatArray.setValue({}, [1, 2, 3]);
  b.floatArray.setValue({}, [1, 2, 3]);
  expect(uploadA).toHaveBeenCalledTimes(1);
  expect(uploadB).toHaveBeenCalledTimes(1);
});
