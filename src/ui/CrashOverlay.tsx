import { useState } from 'react';
import { game } from '../game/store';
import { hasSave, loadWorldFromStorage } from '../game/persistence';
import { getTutorial, endTutorial } from '../tutorial/runtime';
import { getScenarioRun, endScenario } from '../scenarios/runtime';

/** Recovery never serializes the potentially broken world over a good save. */
export function CrashOverlay({ error, onRecover }: { error: Error; onRecover: () => void }) {
  const [copyStatus, setCopyStatus] = useState('Copy report');
  const [loadError, setLoadError] = useState('');
  const canLoad = !game.get().multiplayer && !getTutorial() && !getScenarioRun() && safeHasQuicksave();
  const report = `Web Space Program runtime report\n${new Date().toISOString()}\n${navigator.userAgent}\nScene: ${game.get().scene}\n${error.stack ?? error.message}`;
  const home = () => {
    if (getTutorial()) endTutorial();
    else if (getScenarioRun()) endScenario();
    else game.set({ scene: 'spaceCenter', multiplayer: null, launchPending: false });
    onRecover();
  };
  const reload = () => {
    try {
      const saved = loadWorldFromStorage('quicksave')?.data;
      if (!saved) return setLoadError('The quicksave could not be read. You can return to the Space Center.');
      game.set({ scene: 'flight', resumeWorld: saved, mode: saved.mode ?? 'sandbox', scalePreset: saved.preset, launchPending: false });
      onRecover();
    } catch { setLoadError('The quicksave could not be read. You can return to the Space Center.'); }
  };
  return <div className="fullscreen" role="alert" style={{ display: 'grid', placeItems: 'center', background: '#080e18', zIndex: 1000 }}>
    <section className="panel" style={{ padding: 28, maxWidth: 540, margin: 20 }}>
      <h2 style={{ marginTop: 0 }}>{game.get().scene === 'flight' ? 'Flight interrupted' : 'Something went wrong'}</h2>
      <p>The game hit an unexpected error. Your existing saves have not been overwritten by this recovery screen.</p>
      <details><summary>Error details</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', fontSize: 12 }}>{report}</pre></details>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
        <button className="btn" onClick={() => void (navigator.clipboard?.writeText(report) ?? Promise.reject(new Error('No clipboard'))).then(() => setCopyStatus('Report copied'), () => setCopyStatus('Copy failed — select Error details'))}>{copyStatus}</button>
        <button className="btn primary" onClick={home}>Return to Space Center</button>
        <button className="btn" disabled={!canLoad} title={canLoad ? 'Restore the last quicksave' : 'No quicksave available in this session'} onClick={reload}>Reload last quicksave</button>
      </div>
      {loadError && <p>{loadError}</p>}
    </section>
  </div>;
}

/** The recovery screen must render even when storage itself is what failed. */
function safeHasQuicksave(): boolean {
  try { return hasSave('quicksave'); } catch { return false; }
}
