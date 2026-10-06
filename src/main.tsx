import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { game } from './game/store';
import { autoConfigureGraphics } from './render/core/quality';
import { preloadTextureCache } from './render/core/textureCache';

// First run / new graphics profile: choose a preset for this GPU (weak iGPUs start on Low).
const graphicsNotice = autoConfigureGraphics();
if (graphicsNotice) game.set({ notice: graphicsNotice });

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

// Dev/perf shortcut: ?mission=<scenario-id> starts a quick-start scenario (e.g. ring-skimmer at Saturn).
const mission = params.get('mission');
if (mission) import('./scenarios/runtime').then(({ startScenario }) => startScenario(mission));

createRoot(document.getElementById('root')!).render(<App />);
// Benchmark/automation hook (scripts/bench/gpu-bench.mjs drives scene changes through the store).
(window as unknown as { __game?: typeof game }).__game = game;
// Decode procedurally generated textures saved by an earlier session (off the main thread).
setTimeout(() => void preloadTextureCache(), 0);
