import { game, updateSettings, type Settings } from '../game/store';
import { getQuality, UPSCALE_LEVELS, type AdvancedGraphics, type QualityId, type UpscaleLevel } from '../render/core/quality';

const levels: QualityId[] = ['low', 'medium', 'high', 'ultra'];
const upscaleLabels: Record<UpscaleLevel, string> = { native: 'Native (no upscaling)', quality: 'Quality — 85%', balanced: 'Balanced — 70%', performance: 'Performance — 58%' };
/** Preset value → nearest named level, for display when no advanced override is set. */
const upscaleLevel = (q: ReturnType<typeof getQuality>): UpscaleLevel => q.upscale.mode === 'off' ? 'native'
  : (Object.keys(UPSCALE_LEVELS) as UpscaleLevel[]).reduce((a, b) => Math.abs(UPSCALE_LEVELS[b] - q.upscale.retinaScale) < Math.abs(UPSCALE_LEVELS[a] - q.upscale.retinaScale) ? b : a);
export function AdvancedGraphicsPanel({ settings }: { settings: Settings }) {
  const q = getQuality(settings.quality);
  const set = <K extends keyof AdvancedGraphics>(key: K, value: AdvancedGraphics[K]) =>
    updateSettings({ graphicsCustom: true, advancedGraphics: { ...game.get().settings.advancedGraphics, [key]: value } });
  const select = <K extends keyof AdvancedGraphics>(key: K, label: string, hint: string, value: string | number, options: readonly (string | number)[]) =>
    <label className="setting-row" title={hint} key={key}><span>{label}<small className="graphics-hint">{hint}</small></span><select aria-label={label} value={value} onChange={e => set(key, (key === 'maxPixelRatio' ? +e.target.value : e.target.value) as AdvancedGraphics[K])}>{options.map(v => <option key={v} value={v}>{v === 'msaa+smaa' ? 'MSAA + SMAA' : String(v)}</option>)}</select></label>;
  const toggle = (label: string, hint: string, checked: boolean, onChange: (v: boolean) => void) =>
    <label className="setting-row" title={hint}><span>{label}<small className="graphics-hint">{hint}</small></span><input aria-label={label} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /></label>;
  return <details className="advanced-graphics" open><summary>Advanced graphics</summary>
    <p className="settings-note">Resolution, anti-aliasing, shadows, bloom and particles apply live. Terrain, sky, clouds, textures, vegetation, stars and parts rebuild the flight scene while preserving your flight. In multiplayer these rebuild changes apply on re-entry. Other scenes apply changes on entry.</p>
    <label className="setting-row" title="More pixels sharpen the scene and increase GPU work quadratically."><span>Render resolution / scale<small className="graphics-hint">3D pixels only; HUD stays sharp. Higher costs GPU time.</small></span><span><input aria-label="Render resolution / scale" type="range" min="0.5" max="1.5" step="0.05" value={settings.renderScale} onChange={e => updateSettings({ renderScale: +e.target.value, graphicsCustom: true })} /><output>{Math.round(settings.renderScale * 100)}%</output></span></label>
    <label className="setting-row" title="Renders the 3D scene at a fraction of Retina resolution and reconstructs full resolution with an edge-aware upscaler and sharpening. 70% draws about half the pixels."><span>Retina resolution / upscaling<small className="graphics-hint">High-density displays only. Lower is faster; the HUD stays sharp.</small></span><select aria-label="Retina resolution / upscaling" value={settings.advancedGraphics.upscale ?? upscaleLevel(q)} onChange={e => set('upscale', e.target.value as UpscaleLevel)}>{(Object.keys(upscaleLabels) as UpscaleLevel[]).map(v => <option key={v} value={v}>{upscaleLabels[v]}</option>)}</select></label>
    {select('maxPixelRatio', 'Max pixel ratio (Retina)', 'Limits device resolution. 2× draws four times as many pixels as 1×.', q.maxPixelRatio, [1, 1.5, 2, 3])}
    {select('antiAliasing', 'Anti-aliasing', 'FXAA is cheapest; SMAA preserves detail. MSAA adds memory and GPU cost.', q.msaaSamples ? 'msaa+smaa' : q.aa === 'none' ? 'off' : q.aa, ['off', 'fxaa', 'smaa', 'msaa+smaa'])}
    {select('shadowQuality', 'Shadows', 'Higher maps sharpen shadows; Ultra uses a 4096² map. One sun shadow map.', settings.advancedGraphics.shadowQuality ?? (q.shadowMapSize ? settings.quality : 'off'), ['off', ...levels])}
    {select('terrainDetail', 'Terrain detail', 'Finer nearby geometry increases draws, worker work and memory. Rebuild.', settings.advancedGraphics.terrainDetail ?? settings.quality, levels)}
    {select('groundClutter', 'Ground clutter / vegetation', 'More rocks and trees over a larger radius. Costs geometry and draws. Rebuild.', settings.advancedGraphics.groundClutter ?? settings.quality, ['off', ...levels])}
    {select('atmosphereQuality', 'Atmosphere quality', 'More scattering samples smooth the sky and haze. Costs GPU time. Rebuild.', q.earth.atmosphereQuality, levels)}
    {toggle('Atmospheric scattering', 'Sky and aerial haze. Turning off saves shader work. Rebuild.', settings.scatter, v => updateSettings({ scatter: v, graphicsCustom: true }))}
    {select('cloudQuality', 'Cloud quality', 'Sharper cloud maps and more detail samples. Costs texture memory and GPU time. Rebuild.', q.clouds ? q.earth.cloudQuality : 'off', ['off', ...levels])}
    {select('textureQuality', 'Earth texture quality', 'NASA Earth imagery resolution: Low 2k and Medium 4k are bundled; High 8k and Ultra 16k download once and are cached (Ultra ≈ 0.8 GB GPU memory). Rebuild.', q.earth.textureQuality, levels)}
    {select('oceanQuality', 'Ocean quality', 'Wave detail, wind-driven sun glint and sky-reflection samples over water. Costs GPU time. Rebuild.', q.earth.oceanQuality, levels)}
    {toggle('Night lights', 'Surface city emission on Earth. Saves night-side shader work when disabled. Rebuild.', q.earth.nightLights, v => set('nightLights', v))}
    {toggle('Bloom', 'Glow around bright engines and sunlight. Adds post-processing GPU cost.', settings.bloom, v => updateSettings({ bloom: v, graphicsCustom: true }))}
    {select('starQuality', 'Stars / Milky Way', 'More stars; off also hides the Milky Way. Costs geometry and a sky texture. Rebuild.', settings.advancedGraphics.starQuality ?? settings.quality, ['off', ...levels])}
    {select('particleQuality', 'Particle effects', 'Low/Medium/High/Ultra pools: 128/512/1024/2048 particles. More smoke and sparks cost GPU time.', q.particleQuality, levels)}
    {select('partDetail', 'Part detail', 'High adds tessellation and fine hardware. Costs geometry and memory. Rebuild.', q.partDetail, ['low', 'high'])}
    <label className="setting-row" title="Limits rendering cadence. Unlimited follows your display, including 120 Hz ProMotion."><span>Frame-rate cap<small className="graphics-hint">Lower caps reduce power use. Unlimited follows display refresh.</small></span><select aria-label="Frame-rate cap" value={settings.frameRateCap} onChange={e => updateSettings({ frameRateCap: +e.target.value as Settings['frameRateCap'], graphicsCustom: true })}>{[30, 60, 120, 0].map(v => <option key={v} value={v}>{v || 'unlimited'}</option>)}</select></label>
    {toggle('Adaptive resolution', 'Lowers 3D resolution under GPU pressure and restores it with headroom.', settings.adaptiveQuality, v => updateSettings({ adaptiveQuality: v, graphicsCustom: true }))}
  </details>;
}
