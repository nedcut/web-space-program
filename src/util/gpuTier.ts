/**
 * Heuristic GPU classification from the WebGL renderer string (WEBGL_debug_renderer_info).
 * Used once on first run to pick a starting quality preset; the user can always override it.
 *
 * - `weak`: software rasterisers, older Intel HD/UHD iGPUs, mobile GPUs → Low.
 * - `mid`: Intel Iris Xe/Arc, AMD/Apple integrated, unknown → Medium (the default).
 * - `strong`: recognised discrete GPUs (still starts on Medium; reported for diagnostics).
 */
export type GpuTier = 'weak' | 'mid' | 'strong';

export function classifyGpu(renderer: string | null | undefined): GpuTier {
  const r = (renderer ?? '').toLowerCase();
  if (!r) return 'mid';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/.test(r)) return 'weak';
  // Mobile/tablet GPUs.
  if (/mali|adreno|powervr|videocore|tegra|apple a\d|sgx/.test(r)) return 'weak';
  if (/intel/.test(r)) {
    if (/arc|iris\(r\) xe|iris xe|xe graphics/.test(r)) return 'mid';
    // Intel HD/UHD and older Iris (Plus/Pro) parts: roughly a third of Iris Xe throughput.
    return 'weak';
  }
  if (/geforce|nvidia|quadro|rtx|gtx/.test(r)) return /mx\s?\d|gt \d|gt\d/.test(r) ? 'mid' : 'strong';
  if (/radeon/.test(r)) {
    if (/\brx\s?\d|pro w|vega 56|vega 64|radeon vii/.test(r)) return 'strong';
    return 'mid'; // Integrated Radeon (Vega 8, 680M/780M, "Radeon(TM) Graphics").
  }
  if (/apple m\d (pro|max|ultra)/.test(r)) return 'strong';
  return 'mid';
}

/** Starting preset for a GPU tier. Discrete GPUs also start at Medium; High is opt-in. */
export function presetForTier(tier: GpuTier): 'low' | 'medium' {
  return tier === 'weak' ? 'low' : 'medium';
}
