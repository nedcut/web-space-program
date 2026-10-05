import { useState } from 'react';
import { photoMode, usePhotoMode, type PhotoSettings } from '../game/photoMode';
export function PhotoPanel() {
  const photo = usePhotoMode(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function capture(scale: 1 | 2) { setBusy(true); setError(''); try { await photoMode.capture(scale); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (!photo.active) return null;
  const sliders: [keyof PhotoSettings, string, number, number, number][] = [['fov', 'Field of view', 15, 100, 1], ['exposure', 'Exposure', 0.1, 4, 0.05], ['focus', 'Focus distance (m)', 1, 2000, 1], ['dof', 'Depth of field', 0, 1, 0.01], ['vignette', 'Vignette', 0, 1, 0.01], ['grain', 'Film grain', 0, 1, 0.01], ['letterbox', 'Letterbox', 0, 0.2, 0.01]];
  return <div className="panel" style={{ position: 'absolute', top: 20, right: 20, width: 270, padding: 18, zIndex: 1000 }}>
    <div className="label">Photo mode · simulation frozen</div><p style={{ fontSize: 12 }}>WASD move · Q/E down/up · drag to look · scroll for speed · Shift faster · P/Esc exit</p>
    {sliders.map(([key, label, min, max, step]) => <label key={key} style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>{label} · {photo.settings[key].toFixed(key === 'focus' || key === 'fov' ? 0 : 2)}<input style={{ width: '100%' }} type="range" min={min} max={max} step={step} value={photo.settings[key]} onChange={e => photoMode.set({ [key]: Number(e.target.value) })} /></label>)}
    <div style={{ display: 'flex', gap: 6 }}><button className="btn small" disabled={busy} onClick={() => void capture(1)}>PNG 1×</button><button className="btn small" disabled={busy} onClick={() => void capture(2)}>PNG 2×</button><button className="btn small" onClick={() => photoMode.close()}>Exit</button></div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
