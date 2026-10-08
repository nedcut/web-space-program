import { cutImageStrips, type ImageStrips } from './imageStrips';

let worker: Worker | null = null;
let unavailable = false;
let nextId = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, { resolve: (s: ImageStrips) => void; fallback: () => void }>();

function scheduleIdle(): void {
  clearTimeout(idleTimer);
  if (!pending.size) idleTimer = setTimeout(() => { worker?.terminate(); worker = null; }, 30000);
}

function getWorker(): Worker {
  clearTimeout(idleTimer);
  if (!worker) {
    worker = new Worker(new URL('./imageryDecode.worker.ts', import.meta.url), { type: 'module', name: 'earth-imagery-decode' });
    worker.onmessage = (event: MessageEvent<{ id: number; result?: ImageStrips; error?: string }>) => {
      const { id, result } = event.data;
      const job = pending.get(id);
      pending.delete(id);
      if (job) { if (result) job.resolve(result); else job.fallback(); }
      else if (result) releaseImagery(result);
      scheduleIdle();
    };
    worker.onerror = event => {
      event.preventDefault();
      unavailable = true;
      worker?.terminate(); worker = null;
      for (const job of pending.values()) job.fallback();
      pending.clear();
    };
  }
  return worker;
}

/** Cropping big decoded images can block Chrome despite createImageBitmap returning a promise. */
export function decodeImagery(blob: Blob, stripBytes: number): Promise<ImageStrips> {
  if (unavailable || typeof Worker === 'undefined') return cutImageStrips(blob, stripBytes);
  try {
    const target = getWorker();
    return new Promise<ImageStrips>((resolve, reject) => {
      const id = nextId++;
      const fallback = () => { void cutImageStrips(blob, stripBytes).then(resolve, reject); };
      pending.set(id, { resolve, fallback });
      try { target.postMessage({ id, blob, stripBytes }); }
      catch { pending.delete(id); fallback(); scheduleIdle(); }
    });
  } catch { unavailable = true; return cutImageStrips(blob, stripBytes); }
}

/** Last reference only: transferring relinquishes main-thread ownership after the GPU copy is submitted. */
export function releaseImagery(source: ImageStrips): void {
  const bitmaps = source.strips.map(s => s.bitmap);
  if (!unavailable && typeof Worker !== 'undefined') {
    try {
      getWorker().postMessage({ type: 'release', bitmaps }, bitmaps);
      scheduleIdle();
      return;
    } catch {
      if (worker) scheduleIdle();
      // Worker/CSP/transfer unavailable: release a single bitmap in each task below.
    }
  }
  void (async () => {
    for (const bitmap of bitmaps) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      bitmap.close();
    }
  })();
}
