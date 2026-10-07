/** One background job per idle turn. A shared queue prevents a dialog's previews forming one long task. */
const jobs: { run: () => void | Promise<void>; cancelled: boolean }[] = [];
let scheduled = false;
let lastInput = -Infinity;
let listening = false;
function observeInput() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  for (const name of ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel'])
    document.addEventListener(name, () => { lastInput = performance.now(); }, { capture: true, passive: true });
}
function schedule() {
  if (scheduled || !jobs.length) return;
  scheduled = true;
  const pump = async () => {
    const quietIn = 120 - (performance.now() - lastInput);
    if (quietIn > 0) { setTimeout(() => { scheduled = false; schedule(); }, quietIn); return; }
    const job = jobs.shift();
    try { if (job && !job.cancelled) await job.run(); } finally { scheduled = false; schedule(); }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(pump, { timeout: 500 });
  else setTimeout(pump, 32);
}
export function enqueueIdle(run: () => void | Promise<void>): () => void {
  observeInput();
  const job = { run, cancelled: false };
  jobs.push(job);
  schedule();
  return () => { job.cancelled = true; };
}
