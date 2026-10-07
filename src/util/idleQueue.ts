/** One background job per idle turn. A shared queue prevents a dialog's previews forming one long task. */
const jobs: { run: () => void | Promise<void>; cancelled: boolean }[] = [];
let scheduled = false;
function schedule() {
  if (scheduled || !jobs.length) return;
  scheduled = true;
  const pump = async () => {
    const job = jobs.shift();
    try { if (job && !job.cancelled) await job.run(); } finally { scheduled = false; schedule(); }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(pump, { timeout: 500 });
  else setTimeout(pump, 32);
}
export function enqueueIdle(run: () => void | Promise<void>): () => void {
  const job = { run, cancelled: false };
  jobs.push(job);
  schedule();
  return () => { job.cancelled = true; };
}
