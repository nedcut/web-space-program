import { useSyncExternalStore } from 'react';
import { bindingLabel, getBindings, subscribeBindings, type Action } from '../../input/bindings';
const SEEN_KEY = 'wsp.help.seen.v1';

export function helpSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markHelpSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

const FLIGHT_KEYS: [Action[] | string, string][] = [
  [['stage'], 'Stage (first press releases the clamps)'],
  [['stageLock'], 'Lock / unlock staging'],
  [['throttleUp', 'throttleDown'], 'Throttle up / down'],
  [['throttleFull', 'throttleCut'], 'Full throttle / cut throttle'],
  [['pitchUp', 'pitchDown', 'yawLeft', 'yawRight', 'rollLeft', 'rollRight'], 'Pitch · yaw · roll'],
  [['toggleSas'], 'SAS (attitude hold) on / off'],
  [['sasHold'], 'Hold: toggle SAS while held'],
  [['toggleRcs'], 'RCS thrusters on / off'],
  [['translateForward', 'translateBack', 'translateLeft', 'translateRight', 'translateUp', 'translateDown'], 'RCS translate'],
  [['precision'], 'Precision (fine) controls: smaller deflections, slower throttle'],
  ['Alt + W / S / A / D / Q / E', 'Trim (applies with SAS off)'],
  [['trimReset'], 'Clear trim'],
  [['toggleGear', 'brakes'], 'Landing gear / wheel brakes'],
  [['toggleLights'], 'Lights on / off'],
  [['abort'], 'Abort: cut throttle and fire the Abort group'],
  ['1 – 0', 'Action groups 1 … 10 (assign in the editor)'],
  ['Right-click a part (long-press on touch)', 'Part details, actions and settings'],
  [['map'], 'Map view + maneuver planner'],
  ['Tab', 'Map view: cycle focus'],
  [['warpDown', 'warpUp', 'warpStop'], 'Time warp slower / faster / stop'],
  [['toggleCamMode'], 'Camera mode (auto / free / orbital / chase / locked / tower near the ground)'],
  [['cameraLeft', 'cameraRight', 'cameraUp', 'cameraDown', 'cameraZoomIn', 'cameraZoomOut'], 'Orbit / zoom camera from the keyboard'],
  [['focusPrev', 'focusNext'], 'Switch to the previous / next nearby vessel'],
  [['eva'], 'EVA (or the EVA button on a crew portrait)'],
  [['quicksave', 'quickload'], 'Quicksave / quickload'],
  [['screenshot'], 'Screenshot (PNG of the flight view)'],
  [['hideUi'], 'Hide / show the interface'],
  [['flightResults'], 'Flight results (this flight’s report)'],
  [['flightData'], 'Flight data app'],
  [['stressOverlay'], 'Structural stress overlay'],
  [['photoMode'], 'Photo mode (single player)'],
  [['perfOverlay'], 'Performance overlay (fps, CPU/GPU breakdown)'],
  ['Mouse drag · wheel', 'Orbit camera · zoom'],
  ['Pad: RB + right stick · R3', 'Gamepad camera orbit · camera mode'],
  [['menu'], 'Pause menu (recover, revert, settings)'],
];

const EVA_KEYS: [Action[] | string, string][] = [
  [['evaForward', 'evaLeft', 'evaBack', 'evaRight'], 'Move · strafe'],
  [['evaRun', 'evaUp', 'evaDown'], 'Run (ground) · jetpack up / down (space)'],
  [['stage'], 'Hop'],
  [['board'], 'Board a hatch within 3 m'],
  [['plantFlag'], 'Plant a flag (landed)'],
];

/** First-flight controls cheat sheet (F1 or the "?" button). */
export function HelpOverlay({ eva, onClose }: { eva: boolean; onClose(): void }) {
  const bindings = useSyncExternalStore(subscribeBindings, getBindings);
  // Compact, human key names; only the primary binding per action keeps rows narrow.
  const KEY_NAMES: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Equal: '+', Minus: '−', Backspace: '⌫', Escape: 'Esc', BracketRight: ']', BracketLeft: '[', Comma: ',', Period: '.', Slash: '/', Space: 'Space', Enter: 'Enter' };
  const keyName = (k: string) => k.split('+').map(p => KEY_NAMES[p] ?? p.replace(/Key|Digit|Numpad/g, '').replace(/(Shift|Control|Alt|Meta)(Left|Right)/g, '$1').replace('Control', 'Ctrl')).join('+');
  const keys = (actions: Action[] | string) => typeof actions === 'string' ? actions : actions.map(a => (bindings[a][0] ? keyName(bindings[a][0]) : 'Unbound')).join(' ');
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel help-card" role="dialog" aria-label="Flight controls">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <div className="label">Flight controls</div>
            <div style={{ fontSize: 20, fontWeight: 300, letterSpacing: '0.12em', marginTop: 4 }}>{eva ? 'EVA' : 'FLIGHT'}</div>
          </div>
          <button className="btn small" onClick={onClose}>Got it</button>
        </div>
        {!eva && (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5, margin: '10px 0 0' }}>
            Quick start: press <span className="kbd">{keys(['toggleSas'])}</span> for SAS, <span className="kbd">{keys(['throttleFull'])}</span> for full throttle, then <span className="kbd">{keys(['stage'])}</span> to
            launch. Or open the <b>Flight assist</b> app (top-right toolbar) and let the flight computer fly the ascent.
          </p>
        )}
        {!eva && (
          <p className="help-layout">
            Layout: time warp and clock <b>top-left</b> · altimeter and status lamps <b>top-centre</b> · apps (resources, flight data, science, crew,
            assist, target, comms) <b>top-right</b> · staging <b>bottom-left</b> · navball, SAS and throttle <b>lower-left</b> · crew, map and camera <b>bottom-right</b>.
          </p>
        )}
        <div className="help-grid">
          {(eva ? EVA_KEYS : FLIGHT_KEYS).map(([k, v]) => (
            <div key={v} className="help-row">
              <span>{v}</span>
              <kbd>{keys(k)}</kbd>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Press <span className="kbd">{keys(['help'])}</span> or the <span className="kbd">?</span> button any time to show this again. <span className="kbd">{keys(['menu'])}</span> closes it.
        </div>
      </div>
    </div>
  );
}

/** Short, dismissible first-flight card: the few inputs needed to get off the pad. Shown once (see helpSeen). */
export function QuickStartCard({ onClose, onHelp }: { onClose(): void; onHelp(): void }) {
  const bindings = useSyncExternalStore(subscribeBindings, getBindings);
  const key = (...actions: Action[]) => actions.map(a => bindingLabel(a, bindings)).join(' ');
  const rows: [string, string][] = [
    ['Stage (lights the engines)', key('stage')],
    ['Throttle up / down', `${key('throttleUp')} / ${key('throttleDown')}`],
    ['Steer', key('pitchUp', 'yawLeft', 'pitchDown', 'yawRight')],
    ['Map view', key('map')],
  ];
  return <aside className="panel quick-start" aria-label="First flight">
    <div className="quick-start-head"><span className="label">First flight</span><button className="btn small ghost" onClick={onClose} aria-label="Dismiss first flight card">✕</button></div>
    <p>Stage, then raise the throttle and lift off. Steer in small taps.</p>
    {rows.map(([label, keys]) => <div className="quick-start-row" key={label}><span>{label}</span><kbd>{keys}</kbd></div>)}
    <p className="quick-start-note">New here? The <b>Training</b> lessons on the main menu walk you through a full launch.</p>
    <button className="btn small" onClick={onHelp}>All controls · {bindingLabel('help', bindings)}</button>
  </aside>;
}
