import { storageBlocked, STORAGE_BLOCKED_NOTICE } from './ui/storageGuard';
import { earthDataMessage, loadEarthData } from './game/earthLoader';
import { setEarthDataSource } from './render/planet/earthSource';
import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { RootErrorBoundary } from './ui/ErrorBoundary';
import { game } from './game/store';
import { autoConfigureGraphics, GRAPHICS_PROFILE } from './render/core/quality';
import { preloadTextureCache } from './render/core/textureCache';

const root = document.getElementById('root')!;
root.textContent = 'Loading Earth geography…';
// Fetch the 16 MiB grid while the application chunk downloads and evaluates.
// Both must finish before any scene (or menu action) can create Earth terrain.
const appModule = import('./ui/App');
void preloadTextureCache();
let App: (typeof import('./ui/App'))['App'];
try { [ , { App } ] = await Promise.all([loadEarthData(), appModule]); } catch (error) {
  root.textContent = String(error);
  throw error;
}
// Terrain workers reuse the fetched Blob rather than the render layer building a second 16 MiB copy.
setEarthDataSource(earthDataMessage);

// First run / new graphics profile: choose a preset for this GPU (weak iGPUs start on Low).
// Probing the GPU creates a throwaway WebGL context (~30 ms on the main thread): only when a re-tune is due.
const graphicsNotice = game.get().settings.graphicsProfile >= GRAPHICS_PROFILE ? null : autoConfigureGraphics();
if (graphicsNotice) game.set({ notice: graphicsNotice });
if (storageBlocked) game.set({ notice: STORAGE_BLOCKED_NOTICE });

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

const application = <RootErrorBoundary><App /></RootErrorBoundary>;
// Opt-in production profiling build; ordinary production includes no Profiler component.
const uiProfile: { phase: string; duration: number; commitTime: number }[] = [];
if (import.meta.env.WSP_PROFILE) Object.assign(window, { __uiProfile: uiProfile });
createRoot(document.getElementById('root')!).render(import.meta.env.WSP_PROFILE
  ? <Profiler id="app" onRender={(_id, phase, duration, _base, _start, commitTime) => {
    uiProfile.push({ phase, duration, commitTime });
    if (uiProfile.length > 2000) uiProfile.shift();
  }}>{application}</Profiler> : application);
// Benchmark/automation hook (scripts/bench/gpu-bench.mjs drives scene changes through the store).
(window as unknown as { __game?: typeof game }).__game = game;

