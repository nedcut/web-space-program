import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { game } from './game/store';

// Dev shortcut: ?flight=<stock-craft-id> jumps straight onto the launch pad with that craft.
const flight = new URLSearchParams(location.search).get('flight');
if (flight) {
  import('./editor/stockCrafts').then(({ STOCK_CRAFTS }) => {
    const sc = STOCK_CRAFTS.find((c) => c.id === flight) ?? STOCK_CRAFTS[1];
    game.set({ craft: sc.build(), scene: 'flight', launchPending: true });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
