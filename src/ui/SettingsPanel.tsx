import { Button, Slider, Toggle, Tabs, Segmented } from './components';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { updateSettings, useGame, type Settings } from '../game/store';
import { actionLabel, conflicts, defaultBindings, getBindings, keyChord, saveBindings, subscribeBindings, type Action } from '../input/bindings';
import { QUALITY_PRESETS } from '../render/core/quality';

const TABS = ['Graphics', 'Audio', 'Controls', 'Gameplay', 'Accessibility'] as const;
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useGame(s => s.settings);
  const bindings = useSyncExternalStore(subscribeBindings, getBindings);
  const [tab, setTab] = useState<typeof TABS[number]>('Graphics');
  const [capture, setCapture] = useState<Action | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (capture) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (/^(Control|Shift|Alt|Meta)/.test(e.code)) return;
        if (e.code === 'Escape') { setCapture(null); return; }
        if (e.repeat) return;
        saveBindings({ ...getBindings(), [capture]: [keyChord(e)] });
        setCapture(null);
      } else if (e.key === 'Tab') {
        const elements = [...dialog.current!.querySelectorAll<HTMLElement>('button, input, select')].filter(el => !el.hasAttribute('disabled'));
        const first = elements[0], last = elements.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first?.focus(); }
        return;
      } else if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close.current(); }
    };
    const release = (e: KeyboardEvent) => {
      if (capture && /^(Control|Shift|Alt|Meta)/.test(e.code)) {
        e.preventDefault(); e.stopImmediatePropagation();
        saveBindings({ ...getBindings(), [capture]: [e.code] }); setCapture(null);
      }
    };
    window.addEventListener('keyup', release, true);
    window.addEventListener('keydown', handler, true);
    return () => { window.removeEventListener('keydown', handler, true); window.removeEventListener('keyup', release, true); previous?.focus(); };
  }, [capture]);
  const range = (key: keyof Settings, label: string, min: number, max: number, step: number, suffix = '') => (
    <label className="setting-row" key={key}><span>{label}</span><span><Slider aria-label={label} min={min} max={max} step={step} value={Number(settings[key])} onChange={e => updateSettings({ [key]: +e.target.value })} /> <output>{Number(settings[key]).toFixed(step < 1 ? 2 : 0)}{suffix}</output></span></label>
  );
  const check = (key: keyof Settings, label: string) => <label className="setting-row" key={key}><span>{label}</span><Toggle checked={Boolean(settings[key])} onChange={e => updateSettings({ [key]: e.target.checked })} /></label>;
  const warnings = conflicts(bindings);
  return <div className="settings-backdrop" data-settings-modal>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="settings-title" className="panel settings-dialog">
      <div className="setting-row"><h2 id="settings-title">Settings</h2><Button className="btn" onClick={onClose}>Done</Button></div>
      <Tabs label="Settings categories" options={TABS} value={tab} panelId="settings-content" className="settings-tabs" onChange={t => { setCapture(null); setTab(t); }} />
      <div role="tabpanel" id="settings-content" aria-label={tab} className="settings-content">
        {tab === 'Graphics' && <>
          <div className="setting-row"><span>Quality preset</span><Segmented label="Quality preset" options={['low', 'medium', 'high'] as const} value={settings.quality} onChange={q => { const p = QUALITY_PRESETS[q]; updateSettings({ quality: q, shadows: p.shadowMapSize > 0, bloom: p.bloom.enabled, clouds: p.clouds, scatter: true, renderScale: p.renderScale }); }} /></div>
          {check('shadows', 'Shadows')}{check('bloom', 'Bloom')}{check('clouds', 'Clouds')}{check('scatter', 'Atmospheric scattering')}
          {check('adaptiveQuality', 'Adaptive render scale')}{range('renderScale', 'Render scale', 0.5, 1.5, 0.05)}{check('showFps', 'Show FPS / draw calls / triangles')}
          <p className="settings-note">Graphics changes apply immediately in flight. Other scenes use the new settings when you enter them.</p>
        </>}
        {tab === 'Audio' && <>{range('masterVolume', 'Master volume', 0, 1, 0.05)}{range('musicVolume', 'Music volume', 0, 1, 0.05)}{range('sfxVolume', 'Effects volume', 0, 1, 0.05)}</>}
        {tab === 'Controls' && <>
          {check('invertPitch', 'Invert pitch')}{check('mouseFlight', 'Mouse flight assist (left drag)')}
          {range('inputSmoothing', 'Input smoothing', 0, 0.5, 0.01, ' s')}{check('gamepadEnabled', 'Enable standard gamepad')}
          {range('deadZone', 'Gamepad dead zone', 0, 0.5, 0.01)}{range('sensitivity', 'Analog sensitivity', 0.25, 2, 0.05)}
          <p className="settings-note">Gamepad: left stick pitch/yaw, right stick horizontal roll; hold LB for translation (left stick X/Z, right stick Y). Triggers change throttle; EVA uses sticks to walk/jetpack and triggers up/down. Hold A 0.75 s to stage/hop; B brakes/board, X SAS, Y RCS, Back map, Start pause, D-pad up/down/left warp. Left stick click runs on EVA.</p>
          <p className="settings-note">Precision mode scales control input to 35%. To rebind, select a control then press a key (Escape cancels). Editor shortcuts accept Ctrl or Command.</p>
          {bindings.throttleDown.some(k => k.startsWith('Control')) && <div role="status" className="settings-warning">Ctrl+W can close your browser tab while pitching and lowering throttle. <Button className="btn small" onClick={() => saveBindings({ ...bindings, throttleDown: ['Minus'], evaDown: ['Minus'] })}>Use Minus for throttle/EVA down</Button></div>}
          {warnings.length > 0 && <details className="settings-warning"><summary>{warnings.length} shared bindings / conflicts</summary>{warnings.map(w => <p key={`${w.key}-${w.actions.join()}`}>{w.key}: {w.actions.map(actionLabel).join(', ')}</p>)}<p>EVA up/run intentionally share Shift.</p></details>}
          <Button className="btn" onClick={() => saveBindings(defaultBindings())}>Reset default bindings</Button>
          {(['flight', 'eva', 'editor'] as const).map(group => <div key={group}><h3>{group === 'flight' ? 'Flight / aircraft / map' : group === 'eva' ? 'EVA' : 'Editor'}</h3>{(Object.keys(bindings) as Action[]).filter(a => group === 'editor' ? a.startsWith('editor') : group === 'eva' ? a.startsWith('eva') || a === 'board' || a === 'plantFlag' : !a.startsWith('editor') && !a.startsWith('eva') && a !== 'board' && a !== 'plantFlag').map(a => <div className="setting-row" key={a}><span>{actionLabel(a)}</span><Button className={`btn small ${capture === a ? 'primary' : ''}`} onClick={() => setCapture(a)}>{capture === a ? 'Press a key…' : bindings[a].join(' / ') || 'Unbound'}</Button></div>)}</div>)}
        </>}
        {tab === 'Gameplay' && <>
          <label className="setting-row">HUD units<select value={settings.units} onChange={e => updateSettings({ units: e.target.value as Settings['units'] })}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label>
          {range('navballSize', 'Navball size', 140, 280, 10, ' px')}{range('hudScale', 'HUD scale', 0.75, 1.3, 0.05)}{range('cameraFov', 'Camera field of view', 40, 100, 1, '°')}{range('autoSaveInterval', 'Auto-save interval (0 = off)', 0, 300, 15, ' s')}
          <label className="setting-row"><span>Communications network</span>
            <select aria-label="Communications network" value={settings.commsEnabled === null ? 'default' : String(settings.commsEnabled)} onChange={e => updateSettings({ commsEnabled: e.target.value === 'default' ? null : e.target.value === 'true' })}>
              <option value="default">Program default</option><option value="true">On</option><option value="false">Off</option>
            </select>
          </label>
          <label className="setting-row"><span>Restrict disconnected probes</span><Toggle checked={settings.commsRestrictControl ?? true} onChange={e => updateSettings({ commsRestrictControl: e.target.checked })} /></label>
          {check('commsOverlay', 'Show comms links in map view')}
          {check('showFps', 'Show FPS / draw calls / triangles')}
        </>}
        {tab === 'Accessibility' && <>{range('uiScale', 'UI scale', 0.8, 1.3, 0.05)}{check('highContrast', 'High-contrast HUD')}{check('reduceMotion', 'Reduce motion (camera effects / flicker)')}{check('colourBlind', 'Colour-blind-friendly navball markers')}</>}
      </div>
    </div>
  </div>;
}
