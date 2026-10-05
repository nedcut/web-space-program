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

const FLIGHT_KEYS: [string, string][] = [
  ['Space', 'Stage (first press releases the clamps)'],
  ['Shift / Ctrl', 'Throttle up / down'],
  ['Z / X', 'Full throttle / cut throttle'],
  ['W S · A D · Q E', 'Pitch · yaw · roll'],
  ['T', 'SAS (attitude hold) on / off'],
  ['R', 'RCS thrusters on / off'],
  ['I K · J L · H N', 'RCS translate'],
  ['G / hold B', 'Landing gear / wheel brakes'],
  ['M', 'Map view + maneuver planner'],
  [', . /', 'Time warp slower / faster / stop'],
  ['V', 'Camera mode (auto / chase / free)'],
  [']', 'Switch to a nearby vessel'],
  ['U', 'EVA: send an astronaut outside'],
  ['F5 / F9', 'Quicksave / quickload'],
  ['Mouse drag · wheel', 'Orbit camera · zoom'],
  ['Esc', 'Pause menu (recover, revert, settings)'],
];

const EVA_KEYS: [string, string][] = [
  ['W A S D · Q E', 'Move · strafe'],
  ['Shift / Ctrl', 'Run (ground) · jetpack up / down (space)'],
  ['Space', 'Hop'],
  ['Enter', 'Board a hatch within 3 m'],
  ['F', 'Plant a flag (landed)'],
];

/** First-flight controls cheat sheet (F1 or the "?" button). */
export function HelpOverlay({ eva, onClose }: { eva: boolean; onClose(): void }) {
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
            Quick start: press <span className="kbd">T</span> for SAS, <span className="kbd">Z</span> for full throttle, then <span className="kbd">Space</span> to
            launch. Or open <b>Assist → Launch to orbit</b> on the left and let the flight computer fly the ascent.
          </p>
        )}
        <div className="help-grid">
          {(eva ? EVA_KEYS : FLIGHT_KEYS).map(([k, v]) => (
            <div key={k} className="help-row">
              <span>{v}</span>
              <kbd>{k}</kbd>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Press <span className="kbd">F1</span> or the <span className="kbd">?</span> button any time to show this again. <span className="kbd">Esc</span> closes it.
        </div>
      </div>
    </div>
  );
}
