/** One background job per idle turn. A shared queue prevents a dialog's previews forming one long task. */
const jobs: { run: () => void | Promise<void>; cancelled: boolean }[] = [];
let scheduled = false;
let lastInput = -Infinity;
const INPUT_QUIET_MS = 350;
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
    const quietIn = INPUT_QUIET_MS - (performance.now() - lastInput);
    if (quietIn > 0) { setTimeout(() => { scheduled = false; schedule(); }, quietIn); return; }
    while (jobs[0]?.cancelled) jobs.shift();
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

/** Shader compilation can finish during a gesture: defer its draw/readback until input settles too. */
export function waitForInputQuiet(): Promise<void> {
  return new Promise(resolve => {
    const check = () => {
      const remaining = INPUT_QUIET_MS - (performance.now() - lastInput);
      if (remaining > 0) setTimeout(check, remaining); else resolve();
    };
    check();
  });
}
