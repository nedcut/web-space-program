import { loadEarthData } from './game/earthLoader';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { game } from './game/store';
import { autoConfigureGraphics, GRAPHICS_PROFILE } from './render/core/quality';
import { preloadTextureCache } from './render/core/textureCache';

const root = document.getElementById('root')!;
root.textContent = 'Loading Earth geography…';
try { await loadEarthData(); } catch (error) {
  root.textContent = String(error);
  throw error;
}

// First run / new graphics profile: choose a preset for this GPU (weak iGPUs start on Low).
// Probing the GPU creates a throwaway WebGL context (~30 ms on the main thread): only when a re-tune is due.
const graphicsNotice = game.get().settings.graphicsProfile >= GRAPHICS_PROFILE ? null : autoConfigureGraphics();
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
