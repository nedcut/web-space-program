import { DepartureOptions } from './DepartureOptions';
import type { TransferWindow as DepartureWindow } from '../../game/planning/windows';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { World } from '../../game/world';
import type { PorkchopPoint } from '../../game/interplanetary';
import { formatDate, formatDuration } from '../../ui/format';

import { usePlanner } from './usePlanner';
import { applyPlanningResult } from '../../game/planning/apply';

const N = 36;
export function TransferWindow({ world, target, onClose, onPlanned }: { world: World; target: string; onClose(): void; onPlanned(message: string): void }) {
  const [windows, setWindows] = useState<DepartureWindow[]>([]);
  const windowPlanner = usePlanner(world);
  const { run: listWindows, cancel: cancelWindows } = windowPlanner;
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const { run, cancel, progress } = usePlanner(world);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { previous?.focus(); };
  }, []);
  const [grid, setGrid] = useState<(PorkchopPoint | null)[]>([]);
  const [hover, setHover] = useState<PorkchopPoint | null>(null);
  const [message, setMessage] = useState('Calculating transfer windows…');
  useEffect(() => {
    setWindows([]);
    void listWindows('windows', { target }).then(({ result }) => setWindows(result))
      .catch(e => { if (e.name !== 'AbortError') setMessage(e.message); });
    return cancelWindows;
  }, [target, listWindows, cancelWindows]);
  const busy = !!progress;
  const [range, setRange] = useState<{ start: number; span: number; minFlight: number; maxFlight: number } | null>(null);
  useEffect(() => {
    setGrid([]); setHover(null);
    try {
      const from = world.active!.body, a = world.universe.body(from), b = world.universe.body(target), mu = world.universe.body(world.universe.sunId).gm;
      const na = Math.sqrt(mu / a.orbit!.a ** 3), nb = Math.sqrt(mu / b.orbit!.a ** 3);
      const tof = Math.PI * Math.sqrt(((a.orbit!.a + b.orbit!.a) / 2) ** 3 / mu);
      const r = { start: world.ut + 600, span: 2 * Math.PI / Math.abs(na - nb), minFlight: tof * 0.65, maxFlight: tof * 1.35 };
      setRange(r);
      void run('porkchop', { from, target, departures: { min: r.start, max: r.start + r.span, samples: N }, flights: { min: r.minFlight, max: r.maxFlight, samples: N } }, event => {
        const row = event.row;
        if (row) setGrid(old => {
          const next = [...old]; next.splice(row.index * N, N, ...row.cells); return next;
        });
      }).then(() => setMessage('Hover for details. Click a cell to verify and plan its transfer.'))
        .catch(e => { if (e.name !== 'AbortError') setMessage(e.message); });
    } catch (e) { setMessage((e as Error).message); }
    return cancel;
  }, [world, target, run, cancel]);
  useEffect(() => {
    const g = canvas.current?.getContext('2d');
    if (!g) return;
    const values = grid.flatMap(p => p ? [p.totalDv] : []).sort((a, b) => a - b);
    const min = values[0] ?? 0, max = values[Math.floor(values.length * 0.9)] ?? min + 1;
    g.fillStyle = '#05070d'; g.fillRect(0, 0, 648, 360);
    grid.forEach((p, k) => {
      const dep = Math.floor(k / N), flight = k % N;
      const t = p ? Math.min(1, Math.max(0, (p.totalDv - min) / Math.max(1, max - min))) : 1;
      g.fillStyle = p ? `hsl(${240 - t * 240},85%,55%)` : '#151b28';
      g.fillRect(dep * 18, (N - 1 - flight) * 10, 18, 10);
    });
  }, [grid]);
  const cell = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(N - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * N)));
    const y = Math.min(N - 1, Math.max(0, N - 1 - Math.floor((e.clientY - r.top) / r.height * N)));
    return grid[x * N + y] ?? null;
  };
  const pickWindow = async (w: DepartureWindow) => {
    if (busy) return;
    setMessage('Verifying selected departure…');
    try {
      const { result, snapshot } = await run('interplanetary', { target, options: { departure: w.departure } });
      if (!result) { setMessage('This estimate did not refine to an encounter. Try another window.'); return; }
      applyPlanningResult(world, snapshot, result);
      onPlanned(`Transfer planned: ${result.dv.toFixed(0)} m/s`); onClose();
    } catch (e) { if ((e as Error).name !== 'AbortError') setMessage((e as Error).message); }
  };
  const plan = async (p: PorkchopPoint | null) => {
    if (!p || busy || !range) return;
    setMessage('Verifying encounter and parking-orbit ejection…');
    try {
      const { result, snapshot } = await run('interplanetary', { target, options: {
        departureRange: { min: Math.max(world.ut + 300, p.departureTime - range.span / (N - 1) / 2), max: p.departureTime + range.span / (N - 1) / 2, samples: 5 },
        timeOfFlightRange: { min: Math.max(1, p.timeOfFlight - (range.maxFlight - range.minFlight) / (N - 1) / 2), max: p.timeOfFlight + (range.maxFlight - range.minFlight) / (N - 1) / 2, samples: 5 },
      } });
      if (result) {
        applyPlanningResult(world, snapshot, result);
        onPlanned(`Transfer planned: ${result.dv.toFixed(0)} m/s`); onClose();
      } else setMessage('No verified encounter in this cell. Choose a neighbouring window.');
    } catch (e) { if ((e as Error).name !== 'AbortError') setMessage((e as Error).message); }
  };
  return createPortal(<div ref={dialog} tabIndex={-1} className="transfer-modal" role="dialog" aria-modal="true" aria-label="Transfer window" onKeyDown={e => {
    e.stopPropagation();
    if (e.key === 'Escape') onClose();
    if (e.key === 'Tab') {
      e.preventDefault();
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
    }
  }}>
    <div className="panel transfer-plot">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="label">Transfer window · {world.universe.body(target).name}</span><button className="btn small" onClick={onClose}>Close</button></div>
      {windowPlanner.progress && <div role="status" className="label">Finding upcoming departures…</div>}
      <DepartureOptions world={world} options={{ target, windows }} busy={busy} onPick={pickWindow} />
      <div className="label">Flight time ↑ · departure date →</div>
      <canvas ref={canvas} width={648} height={360} aria-label="Departure date versus flight time, total delta-v colour map" onMouseMove={e => setHover(cell(e))} onMouseLeave={() => setHover(null)} onClick={e => plan(cell(e))} />
      {range && <div className="mono" style={{ fontSize: 11 }}>{formatDate(range.start)} → {formatDate(range.start + range.span)} · flight {formatDuration(range.minFlight)}–{formatDuration(range.maxFlight)}</div>}
      <div style={{ background: 'linear-gradient(90deg,blue,cyan,lime,yellow,red)', height: 8, borderRadius: 3 }} />
      <div className="label">Blue: lower Δv · red: higher Δv · dark: no solution</div>
      <div className="mono" style={{ minHeight: 40, fontSize: 12 }}>{hover ? `Depart ${formatDate(hover.departureTime)} · arrive ${formatDate(hover.arrivalTime)} · fly ${formatDuration(hover.timeOfFlight)} · Δv ${hover.totalDv.toFixed(0)} m/s (departure ${hover.departureDv.toFixed(0)} + capture ${hover.captureDv.toFixed(0)})` : 'Grid estimates include circular capture. Click plans a verified encounter within the selected cell.'}</div>
      {progress && <div role="status" style={{ fontSize: 12 }}>
        Planning… {progress.phase} ({Math.round(progress.fraction * 100)}%)
        <progress aria-label="Transfer window progress" value={progress.fraction} max={1} />
        <button className="btn small" onClick={() => { cancel(); setMessage('Planning cancelled. Completed cells remain available.'); }}>Cancel</button>
      </div>}
      <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>{message}</div>
    </div>
  </div>, document.body);
}
