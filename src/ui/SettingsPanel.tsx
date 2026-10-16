import type { World } from '../game/world';
import { openProgram, saveProgram } from '../game/program';
import { Button, ConfirmModal, Slider, Toggle, Tabs } from './components';
import { useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { defaultSettings, updateSettings, useGame, type Settings } from '../game/store';
import { actionLabel, bindingLabel, defaultBindings, getBindings, keyChord, saveBindings, subscribeBindings, type Action, type Bindings } from '../input/bindings';
import { AdvancedGraphicsPanel } from './AdvancedGraphics';
import { autoConfigureGraphics, GRAPHICS_PROFILE, presetSettings } from '../render/core/quality';
import { graphicsLabel } from './graphicsLabels';
import { useEscape } from './nav/escape';
import './settings.css';
import { SETTINGS_TABS, SettingsSearch, bindingChanged, bindingClashes, resetPatch, useSettingVisible, type SettingsTab } from './settingsModel';

/** One labelled settings row; hidden while a search is active and nothing in it matches. */
function Row({ label, hint, keywords, children }: { label: string; hint?: string; keywords?: string; children: ReactNode }) {
  if (!useSettingVisible(label, hint, keywords)) return null;
  return <label className="setting-row" title={hint}><span>{label}{hint && <small className="graphics-hint">{hint}</small>}</span>{children}</label>;
}
/** Explanatory text only shows while browsing a tab, not in search results. */
function Note({ children }: { children: ReactNode }) {
  return useContext(SettingsSearch).query ? null : <p className="settings-note">{children}</p>;
}

const BINDING_GROUPS = [
  ['flight', 'Flight / aircraft / map'], ['eva', 'EVA'], ['editor', 'Editor'],
] as const;
const groupOf = (a: Action) => a.startsWith('editor') ? 'editor' : a.startsWith('eva') || a === 'board' || a === 'plantFlag' ? 'eva' : 'flight';
const DEFAULT_BINDINGS = defaultBindings();

function BindingRow({ action, bindings, capturing, onCapture, clash }: { action: Action; bindings: Bindings; capturing: boolean; onCapture: () => void; clash?: Action[] }) {
  const label = actionLabel(action), keys = bindingLabel(action, bindings);
  if (!useSettingVisible(label, keys, 'key binding shortcut')) return null;
  const changed = bindingChanged(bindings, action, DEFAULT_BINDINGS);
  return <div className={`setting-row binding-row${clash ? ' clash' : ''}`}>
    <span>{label}{clash && <small className="binding-clash">Same key as {clash.map(actionLabel).join(', ')}</small>}</span>
    <span className="binding-keys">
      {changed && !capturing && <Button className="btn ghost small" title={`Reset to ${bindingLabel(action, DEFAULT_BINDINGS)}`} onClick={() => saveBindings({ ...getBindings(), [action]: [...DEFAULT_BINDINGS[action]] })}>Reset</Button>}
      <Button className={`btn small binding-key${capturing ? ' primary' : ''}`} aria-label={`${label}: ${capturing ? 'press a key' : keys}`} onClick={onCapture}>{capturing ? 'Press a key…' : keys}</Button>
    </span>
  </div>;
}

export function SettingsPanel({ onClose, world }: { onClose: () => void; world?: World }) {
  const [program] = useState(() => world ?? openProgram());
  const [precise, setPrecise] = useState(program.preciseGravity);
  const [lagrange, setLagrange] = useState(program.showLagrangePoints);
  const settings = useGame(s => s.settings);
  const bindings = useSyncExternalStore(subscribeBindings, getBindings);
  const [tab, setTab] = useState<SettingsTab>('Graphics');
  const [query, setQuery] = useState('');
  const [capture, setCapture] = useState<Action | null>(null);
  const [resetting, setResetting] = useState<SettingsTab | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const dialog = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEscape(() => close.current(), true, 'modal');
  // Esc clears an active search before it closes Settings; while rebinding it cancels the capture.
  useEscape(() => { setQuery(''); search.current?.focus(); }, query !== '', 'modal');
  useEscape(() => setCapture(null), capture !== null, 'capture');
  // Search is focused on open; focus returns to the opener on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (search.current ?? dialog.current)?.focus({ preventScroll: true });
    return () => { previous?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (capture) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (/^(Control|Shift|Alt|Meta)/.test(e.code)) return;
        if (e.repeat) return;
        saveBindings({ ...getBindings(), [capture]: [keyChord(e)] });
        setCapture(null);
      } else if (e.key === 'Tab' && !(e.target as HTMLElement | null)?.closest?.('dialog')) {
        // Keep Tab inside Settings (a confirmation dialog on top traps focus itself).
        const elements = [...dialog.current!.querySelectorAll<HTMLElement>('button, input, select, summary')].filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
        const first = elements[0], last = elements.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first?.focus(); }
      }
    };
    const release = (e: KeyboardEvent) => {
      if (capture && /^(Control|Shift|Alt|Meta)/.test(e.code)) {
        e.preventDefault(); e.stopImmediatePropagation();
        saveBindings({ ...getBindings(), [capture]: [e.code] }); setCapture(null);
      }
    };
    window.addEventListener('keyup', release, true);
    window.addEventListener('keydown', handler, true);
    return () => { window.removeEventListener('keydown', handler, true); window.removeEventListener('keyup', release, true); };
  }, [capture]);

  const range = (key: keyof Settings, label: string, min: number, max: number, step: number, suffix = '', hint?: string) => (
    <Row key={key} label={label} hint={hint}><span><Slider aria-label={label} min={min} max={max} step={step} value={Number(settings[key])} onChange={e => updateSettings({ [key]: +e.target.value })} /> <output>{Number(settings[key]).toFixed(step < 1 ? 2 : 0)}{suffix}</output></span></Row>
  );
  const check = (key: keyof Settings, label: string, hint?: string) => <Row key={key} label={label} hint={hint}><Toggle aria-label={label} checked={Boolean(settings[key])} onChange={e => updateSettings({ [key]: e.target.checked })} /></Row>;
  const clashes = bindingClashes(bindings);
  const systemReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sections: Record<SettingsTab, () => ReactNode> = {
    Graphics: () => <>
      <Row label="Quality preset" keywords="graphics low medium high ultra"><select aria-label="Quality preset" value={settings.graphicsCustom ? 'custom' : settings.quality} onChange={e => { if (e.target.value !== 'custom') updateSettings(presetSettings(e.target.value as Settings['quality'])); }}>
        {['low', 'medium', 'high', 'ultra'].map(v => <option key={v} value={v}>{graphicsLabel(v)}</option>)}
        {settings.graphicsCustom && <option value="custom">Custom (based on {graphicsLabel(settings.quality)})</option>}
      </select></Row>
      <Note>Low suits older integrated GPUs; Medium suits current laptops. Ultra is an opt-in for strong desktop GPUs and uses more memory.</Note>
      <AdvancedGraphicsPanel settings={settings} />
      {check('showFps', 'Show FPS / draw calls / triangles')}{check('perfOverlay', 'Performance overlay: frame graph, CPU/GPU breakdown (F8)')}
    </>,
    Audio: () => <>{range('masterVolume', 'Master volume', 0, 1, 0.05)}{range('musicVolume', 'Music volume', 0, 1, 0.05)}{range('sfxVolume', 'Effects volume', 0, 1, 0.05)}{range('uiVolume', 'Interface & alarms volume', 0, 1, 0.05)}</>,
    Controls: () => <>
      {check('invertPitch', 'Invert pitch')}{check('mouseFlight', 'Mouse flight assist (left drag)')}
      {range('inputSmoothing', 'Input smoothing', 0, 0.5, 0.01, ' s')}{check('gamepadEnabled', 'Enable standard gamepad', 'Controller, joystick')}
      {range('deadZone', 'Gamepad dead zone', 0, 0.5, 0.01)}{range('sensitivity', 'Analog sensitivity', 0.25, 2, 0.05)}
      <Note>Gamepad: left stick pitch/yaw, right stick horizontal roll; hold LB for translation (left stick X/Z, right stick Y). Triggers change throttle; EVA uses sticks to walk/jetpack and triggers up/down. Hold A 0.75 s to stage/hop; B brakes/board, X SAS, Y RCS, Back map, Start pause, D-pad up/down/left warp. Left stick click runs on EVA.</Note>
      <Note>To rebind, select a control and press a key (Esc cancels). Precision mode scales control input to 35%. Editor shortcuts accept Ctrl or Command. A few keys are shared on purpose where the contexts never overlap (EVA up and run both use Shift).</Note>
      {!query && bindings.throttleDown.some(k => k.startsWith('Control')) && <div role="status" className="settings-warning">Ctrl+W can close your browser tab while pitching and lowering throttle. <Button className="btn small" onClick={() => saveBindings({ ...bindings, throttleDown: ['Minus'], evaDown: ['Minus'] })}>Use Minus for throttle/EVA down</Button></div>}
      {!query && clashes.size > 0 && <div role="status" className="settings-warning">{clashes.size} controls share a key with another control in the same context; they are marked below.</div>}
      {BINDING_GROUPS.map(([group, title]) => <div key={group} className="settings-group"><h3>{title}</h3>
        {(Object.keys(bindings) as Action[]).filter(a => groupOf(a) === group).map(a => <BindingRow key={a} action={a} bindings={bindings} capturing={capture === a} onCapture={() => setCapture(a)} clash={clashes.get(a)} />)}
      </div>)}
    </>,
    Gameplay: () => <>
      <Row label="Precise gravity (n-body) · this save" keywords="physics"><Toggle aria-label="Precise gravity" checked={precise} onChange={e => { program.setPreciseGravity(e.target.checked); setPrecise(e.target.checked); if (!world) saveProgram(program); }} /></Row>
      <Row label="Show Lagrange points in map · this save"><Toggle aria-label="Show Lagrange points in map" checked={lagrange} onChange={e => { program.showLagrangePoints = e.target.checked; setLagrange(e.target.checked); if (!world) saveProgram(program); }} /></Row>
      <Note>Precise gravity integrates vessel perturbations and map paths. High warp may slow near encounters. Bodies stay on Kepler orbits; Lagrange markers are instantaneous approximations. Planners and autopilot use patched conics, so burns may need correction.</Note>
      <Row label="HUD units" keywords="metric imperial"><select aria-label="HUD units" value={settings.units} onChange={e => updateSettings({ units: e.target.value as Settings['units'] })}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></Row>
      {range('navballSize', 'Navball size', 140, 280, 10, ' px')}{range('hudScale', 'HUD scale', 0.75, 1.3, 0.05)}{range('cameraFov', 'Camera field of view', 40, 100, 1, '°')}{range('autoSaveInterval', 'Auto-save interval (0 = off)', 0, 300, 15, ' s')}
      <Row label="Communications network" keywords="comms antenna relay signal">
        <select aria-label="Communications network" value={settings.commsEnabled === null ? 'default' : String(settings.commsEnabled)} onChange={e => updateSettings({ commsEnabled: e.target.value === 'default' ? null : e.target.value === 'true' })}>
          <option value="default">Program default</option><option value="true">On</option><option value="false">Off</option>
        </select>
      </Row>
      <Row label="Restrict disconnected probes" keywords="comms signal"><Toggle aria-label="Restrict disconnected probes" checked={settings.commsRestrictControl ?? true} onChange={e => updateSettings({ commsRestrictControl: e.target.checked })} /></Row>
      {check('commsOverlay', 'Show comms links in map view')}
      {check('launchCountdown', 'Launch countdown (3-2-1 before clamp release)')}
      {check('flightHints', 'Contextual flight tips (once per save)')}
      {check('autoShowRcsPad', 'Open RCS translation pad when docking (until dismissed)')}
    </>,
    Accessibility: () => <>
      {range('uiScale', 'UI scale', 0.8, 1.3, 0.05)}{check('highContrast', 'High-contrast HUD')}
      {check('reduceMotion', 'Reduce motion', systemReducedMotion ? 'Menu and panel animations, camera effects and flicker. Your system already asks for reduced motion, so menu animations are off either way.' : 'Menu and panel animations, camera effects and flicker.')}
      {range('cameraShake', 'Camera shake', 0, 1.5, 0.05)}{check('colourBlind', 'Colour-blind-friendly navball markers')}
    </>,
  };

  const resetTab = (t: SettingsTab) => {
    if (t === 'Graphics') {
      // Re-run first-launch detection (Low for weak GPUs, else Medium) and clear overlays and caps.
      updateSettings({ graphicsProfile: 0, frameRateCap: 0, showFps: false, perfOverlay: false });
      if (autoConfigureGraphics() === null) updateSettings({ ...presetSettings('medium'), adaptiveQuality: true, graphicsProfile: GRAPHICS_PROFILE });
      return;
    }
    updateSettings(resetPatch(t, defaultSettings()));
    if (t === 'Controls') saveBindings(defaultBindings());
  };

  return <div className="settings-backdrop" data-settings-modal>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="settings-title" className="panel settings-dialog">
      <div className="settings-head">
        <h2 id="settings-title">Settings</h2>
        <input ref={search} type="search" className="settings-search" placeholder="Search settings" aria-label="Search settings" value={query} onChange={e => { setCapture(null); setQuery(e.target.value); }} />
        <Button className="btn" onClick={onClose}>Done</Button>
      </div>
      <Tabs label="Settings categories" options={SETTINGS_TABS} value={tab} panelId="settings-content" className={`settings-tabs${query ? ' searching' : ''}`} onChange={t => { setCapture(null); setQuery(''); setTab(t); }} />
      <div role="tabpanel" id="settings-content" aria-label={query ? 'Search results' : tab} className="settings-content">
        {query
          ? SETTINGS_TABS.map(t => <SettingsSearch.Provider key={t} value={{ query, tab: t }}><section className="settings-section" aria-label={t}><h3 className="settings-section-title">{t}</h3>{sections[t]()}</section></SettingsSearch.Provider>)
          : <SettingsSearch.Provider value={{ query: '', tab }}>{sections[tab]()}</SettingsSearch.Provider>}
        {query && <p className="settings-empty">No settings match “{query}”.</p>}
      </div>
      <div className="settings-foot">
        {!query && <Button className="btn ghost" onClick={() => setResetting(tab)}>Reset {tab.toLowerCase()}…</Button>}
        <Button className="btn primary" onClick={onClose}>Done</Button>
      </div>
    </div>
    {resetting && <ConfirmModal title={`Reset ${resetting.toLowerCase()} settings?`} confirmLabel="Reset" danger onCancel={() => setResetting(null)} onConfirm={() => { resetTab(resetting); setResetting(null); }}>
      {resetting === 'Graphics' ? 'Graphics return to the recommended preset for this device, with adaptive resolution on and no frame-rate cap.'
        : resetting === 'Controls' ? 'All key bindings and controller options return to their defaults.'
          : resetting === 'Gameplay' ? 'HUD, camera, auto-save and comms options return to their defaults. Per-save options (precise gravity, Lagrange points) are kept.'
            : `${resetting} options return to their defaults.`}
    </ConfirmModal>}
  </div>;
}
