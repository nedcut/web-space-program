/** Startup UI stays independent of React and scene code while the application downloads. */
export function showStartup(root: HTMLElement) {
  const status = root.querySelector<HTMLElement>('#startup-status')!;
  const detail = root.querySelector<HTMLElement>('#startup-detail')!;
  const progress = root.querySelector<HTMLProgressElement>('progress')!;
  const retry = root.querySelector<HTMLButtonElement>('button')!;
  retry.onclick = () => location.reload();
  let failed = false;
  return {
    progress(received: number, total: number) {
      if (failed) return;
      progress.max = total;
      progress.value = received;
      status.textContent = received === total ? 'Preparing your space program…' : 'Loading Earth geography…';
      detail.textContent = `${(received / 1048576).toFixed(1)} of ${(total / 1048576).toFixed(1)} MiB received · ${Math.floor(received / total * 100)}%`;
    },
    error(error: unknown) {
      failed = true;
      status.textContent = 'Unable to start';
      status.setAttribute('role', 'alert');
      detail.textContent = `${navigator.onLine ? 'Check your connection and try again.' : 'You appear to be offline. Connect to the internet and try again.'} Required game data may not be cached yet.`;
      const reason = document.createElement('p');
      reason.className = 'startup-reason';
      reason.textContent = error instanceof Error ? error.message : String(error);
      detail.after(reason);
      progress.hidden = true;
      retry.hidden = false;
      retry.focus();
    },
  };
}
