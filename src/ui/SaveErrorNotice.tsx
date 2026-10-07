import { useEffect } from 'react';
import { game, useGame } from '../game/store';

const VISIBLE_MS = 12000;

/** Non-blocking notification for failed saves (full or blocked storage); play and navigation continue underneath. */
export function SaveErrorNotice() {
  const error = useGame(s => s.saveError);
  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => { if (game.get().saveError === error) game.set({ saveError: null }); }, VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [error]);
  if (!error) return null;
  return (
    <div className="panel save-error-notice" role="status" aria-live="polite">
      <div>
        <strong>{error.text}</strong>
        <p>{error.hint}</p>
      </div>
      <button className="btn small ghost" title="Dismiss" aria-label="Dismiss save warning" onClick={() => game.set({ saveError: null })}>✕</button>
    </div>
  );
}
