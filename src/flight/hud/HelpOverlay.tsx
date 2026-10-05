import { useSyncExternalStore } from 'react';
import { getBindings, subscribeBindings, type Action } from '../../input/bindings';
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
  [['throttleUp', 'throttleDown'], 'Throttle up / down'],
  [['throttleFull', 'throttleCut'], 'Full throttle / cut throttle'],
  [['pitchUp', 'pitchDown', 'yawLeft', 'yawRight', 'rollLeft', 'rollRight'], 'Pitch · yaw · roll'],
  [['toggleSas'], 'SAS (attitude hold) on / off'],
  [['toggleRcs'], 'RCS thrusters on / off'],
  [['translateForward', 'translateBack', 'translateLeft', 'translateRight', 'translateUp', 'translateDown'], 'RCS translate'],
  [['toggleGear', 'brakes'], 'Landing gear / wheel brakes'],
  [['map'], 'Map view + maneuver planner'],
  [['flightData'], 'Detailed flight data panel'],
  [['warpDown', 'warpUp', 'warpStop'], 'Time warp slower / faster / stop'],
  [['toggleCamMode'], 'Camera mode (auto / chase / free)'],
  [['focusNext'], 'Switch to a nearby vessel'],
  [['eva'], 'EVA: send an astronaut outside'],
  [['quicksave', 'quickload'], 'Quicksave / quickload'],
  ['Mouse drag · wheel', 'Orbit camera · zoom'],
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
  const keys = (actions: Action[] | string) => typeof actions === 'string' ? actions : actions.map(a => [...new Set(bindings[a].map(k => k.replace(/Key|Digit/g, '').replace(/(Shift|Control|Alt|Meta)(Left|Right)/g, '$1').replace('Control', 'Ctrl')))].join(' / ') || 'Unbound').join(' · ');
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel help-card" role="dialog" aria-label="Flight controls">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <div className="label">Flight controls</div>
            <div style={{ fontSize: 20, fontWeight: 300, letterSpacing: '0.12em', marginTop: 4 }}>{eva ? 'EVA' : 'FIRST FLIGHT'}</div>
          </div>
          <button className="btn small" onClick={onClose}>Got it</button>
        </div>
        {!eva && (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5, margin: '10px 0 0' }}>
            Quick start: press <span className="kbd">{keys(['toggleSas'])}</span> for SAS, <span className="kbd">{keys(['throttleFull'])}</span> for full throttle, then <span className="kbd">{keys(['stage'])}</span> to
            launch. Or open <b>Assist → Launch to orbit</b> on the left and let the flight computer fly the ascent.
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
