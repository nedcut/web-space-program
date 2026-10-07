/**
 * Distance-band instance partition for LOD levels (pure; used by the launch-site vegetation). Copies the
 * 16-float matrices and 3-float colours of every instance whose distance from `cam` lies in [lo, hi) into the
 * destination arrays, densely packed, and returns how many were written.
 */
export function packBand(
  xyz: Float32Array, matrices: Float32Array, colors: Float32Array,
  cam: { x: number; y: number; z: number }, lo: number, hi: number,
  outMatrices: Float32Array, outColors: Float32Array,
): number {
  const lo2 = lo * lo, hi2 = hi * hi;
  let k = 0;
  for (let i = 0, count = xyz.length / 3; i < count; i++) {
    const dx = xyz[i * 3] - cam.x, dy = xyz[i * 3 + 1] - cam.y, dz = xyz[i * 3 + 2] - cam.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < lo2 || d2 >= hi2) continue;
    outMatrices.set(matrices.subarray(i * 16, i * 16 + 16), k * 16);
    outColors.set(colors.subarray(i * 3, i * 3 + 3), k * 3);
    k++;
  }
  return k;
}
