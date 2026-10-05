import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { game } from './game/store';

// Dev shortcut: ?flight=<stock-craft-id>&scale=real jumps onto the pad in the selected universe.
const params = new URLSearchParams(location.search);
const preset = params.get('scale');
if (preset === 'standard' || preset === 'challenging' || preset === 'real') game.set({ scalePreset: preset });
if (new URLSearchParams(location.hash.slice(1)).has('craft')) game.set({ scene: 'editor' });
const flight = params.get('flight');
if (flight) {
  import('./editor/stockCrafts').then(({ STOCK_CRAFTS }) => {
    const sc = STOCK_CRAFTS.find((c) => c.id === flight) ?? STOCK_CRAFTS[1];
    game.set({ craft: sc.build(), scene: 'flight', launchPending: true });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
