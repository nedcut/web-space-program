import './menu.css';
import { game } from '../game/store';
import { browserSupport } from './browserSupport';

const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

/** Shown instead of a 3D scene when the browser cannot provide WebGL 2 (rather than a crash or blank page). */
export function UnsupportedScreen() {
  const { reason } = browserSupport();
  return <div className="fullscreen unsupported-screen" role="alert">
    <section className="panel unsupported-card">
      <h2>3D graphics are unavailable</h2>
      <p>Web Space Program draws its rockets and planets with WebGL 2, and this browser did not provide it. Menus still work, but building and flying need 3D.</p>
      <WebglHelp />
      {reason && <details><summary>Browser message</summary><pre className="unsupported-reason">{reason}</pre></details>}
      <div className="unsupported-actions">
        <button className="btn primary" onClick={() => game.set({ scene: 'spaceCenter', launchPending: false })}>Back to Space Center</button>
        <button className="btn" onClick={() => game.set({ scene: 'menu', launchPending: false })}>Main menu</button>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
      </div>
    </section>
  </div>;
}

export function WebglHelp() {
  return <ul className="unsupported-help">
    <li>Use a current version of Firefox, Chrome, Edge or Safari (15 or newer).</li>
    <li>Turn on hardware acceleration ({isFirefox ? 'Firefox: Settings → General → Performance' : 'Chrome/Edge: Settings → System'}) and restart the browser.</li>
    <li>Check {isFirefox ? <code>about:support</code> : <code>chrome://gpu</code>} for “WebGL 2” being disabled or blocklisted; updating the graphics driver usually helps.</li>
  </ul>;
}

/** Compact main-menu warning, so players learn about the problem before choosing New Game. */
export function UnsupportedNotice() {
  if (browserSupport().webgl2) return null;
  return <div className="panel unsupported-notice" role="status">
    <strong>3D graphics are unavailable in this browser.</strong> Menus work, but building and flying need WebGL 2.
    <details><summary>How to fix</summary><WebglHelp /></details>
  </div>;
}
