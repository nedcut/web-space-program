import { DepartureOptions } from './DepartureOptions';
import type { TransferWindow as DepartureWindow } from '../../game/planning/windows';
import type { TransferPlan } from '../../game/planning/transfers';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { World } from '../../game/world';
import type { PorkchopPoint } from '../../game/interplanetary';
import { formatDate, formatDuration } from '../../ui/format';
import { dvText, shortDate, shortDuration } from './plannerFormat';

import { usePlanner } from './usePlanner';
import { applyPlanningResult } from '../../game/planning/apply';
import { useEscape } from '../../ui/nav/escape';
import './planner.css';

const N = 36;
/** Colour ramp position (0 cheap … 1 dear) → cell colour; the legend gradient uses the same stops. */
const ramp = (t: number) => `hsl(${240 - t * 240},85%,55%)`;
const LEGEND = `linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(ramp).join(',')})`;

export function TransferWindow({ world, target, onClose, onPlanned }: { world: World; target: string; onClose(): void; onPlanned(plan: TransferPlan, captureDv?: number): void }) {
  const [windows, setWindows] = useState<DepartureWindow[]>([]);
  const windowPlanner = usePlanner(world);
  const { run: listWindows, cancel: cancelWindows } = windowPlanner;
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const { run, cancel, progress } = usePlanner(world);
  useEscape(onClose, true, 'modal');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { previous?.focus(); };
  }, []);
  const [grid, setGrid] = useState<(PorkchopPoint | null)[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [message, setMessage] = useState('');
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
      }).catch(e => { if (e.name !== 'AbortError') setMessage(e.message); });
    } catch (e) { setMessage((e as Error).message); }
    return cancel;
  }, [world, target, run, cancel]);
  // Colour scale (cheapest … 90th percentile) and the cheapest cell, marked on the chart.
  const scale = useMemo(() => {
    let best = -1;
    const values: number[] = [];
    grid.forEach((p, k) => { if (p) { values.push(p.totalDv); if (best < 0 || p.totalDv < grid[best]!.totalDv) best = k; } });
    values.sort((a, b) => a - b);
    const min = values[0] ?? 0;
    return { min, max: values[Math.floor(values.length * 0.9)] ?? min + 1, best };
  }, [grid]);
  useEffect(() => {
    const g = canvas.current?.getContext('2d');
    if (!g) return;
    const { min, max } = scale;
    g.fillStyle = '#05070d'; g.fillRect(0, 0, 648, 360);
    grid.forEach((p, k) => {
      const dep = Math.floor(k / N), flight = k % N;
      const t = p ? Math.min(1, Math.max(0, (p.totalDv - min) / Math.max(1, max - min))) : 1;
      g.fillStyle = p ? ramp(t) : '#151b28';
      g.fillRect(dep * 18, (N - 1 - flight) * 10, 18, 10);
    });
  }, [grid, scale]);
  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(N - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * N)));
    const y = Math.min(N - 1, Math.max(0, N - 1 - Math.floor((e.clientY - r.top) / r.height * N)));
    return x * N + y;
  };
  const pickWindow = async (w: DepartureWindow) => {
    if (busy) return;
    setMessage('Verifying selected departure…');
    try {
      const { result, snapshot } = await run('interplanetary', { target, options: { departure: w.departure } });
      if (!result) { setMessage('This estimate did not refine to an encounter. Try another window.'); return; }
      applyPlanningResult(world, snapshot, result);
      onPlanned(result, w.captureDv); onClose();
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
        onPlanned(result, p.captureDv); onClose();
      } else setMessage('No verified encounter in this cell. Choose a neighbouring window.');
    } catch (e) { if ((e as Error).name !== 'AbortError') setMessage((e as Error).message); }
  };
  const h = hover !== null ? grid[hover] ?? null : null;
  // Cell outline position, as a percentage of the chart.
  const at = (k: number) => ({ left: `${(Math.floor(k / N) / N) * 100}%`, top: `${((N - 1 - (k % N)) / N) * 100}%`, width: `${100 / N}%`, height: `${100 / N}%` });
  const best = scale.best >= 0 ? grid[scale.best] : null;
  return createPortal(<div ref={dialog} tabIndex={-1} className="transfer-modal" role="dialog" aria-modal="true" aria-label="Transfer window" onKeyDown={e => {
    e.stopPropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
    }
  }}>
    <div className="panel transfer-plot">
      <div className="pc-head"><span className="label">Transfer window · {world.universe.body(target).name}</span><button className="btn small" onClick={onClose}>Close <span className="kbd">Esc</span></button></div>
      {windowPlanner.progress && <div role="status" className="label">Finding upcoming departures…</div>}
      <DepartureOptions world={world} options={{ target, windows }} busy={busy} onPick={pickWindow} />
      <div className="pc" title="Total Δv (departure + circular capture) by departure date and flight time. Estimates: a click verifies an encounter within the cell.">
        <div className="pc-y" aria-hidden>
          <span className="pl-num">{range ? shortDuration(range.maxFlight) : ''}</span>
          <span className="pc-y-name">flight time</span>
          <span className="pl-num">{range ? shortDuration(range.minFlight) : ''}</span>
        </div>
        <div className="pc-plot">
          <canvas ref={canvas} width={648} height={360} aria-label="Departure date versus flight time, total delta-v colour map"
            onMouseMove={e => { const k = cellAt(e); if (k !== hover) setHover(k); }} onMouseLeave={() => setHover(null)} onClick={e => plan(grid[cellAt(e)] ?? null)} />
          {best && <span className="pc-best" style={at(scale.best)} title={`Lowest Δv: ${dvText(best.totalDv)}`} />}
          {hover !== null && <span className="pc-hover" style={at(hover)} />}
        </div>
        <div className="pc-x pl-num" aria-hidden>
          {range && <><span>{shortDate(range.start)}</span><span className="pc-x-name">departure</span><span>{shortDate(range.start + range.span)}</span></>}
        </div>
      </div>
      <div className="pc-legend" aria-label={`Colour scale from ${dvText(scale.min)} (blue) to ${dvText(scale.max)} or more (red); dark cells have no solution`}>
        <span className="pl-num">{grid.length ? dvText(scale.min) : ''}</span>
        <span className="pc-ramp" style={{ background: LEGEND }} />
        <span className="pl-num">{grid.length ? `${dvText(scale.max)}+` : ''}</span>
        <span className="pc-none" title="No solution" /><span className="dim">none</span>
        <span className="pc-best-key" title="Lowest Δv cell" /><span className="dim">best</span>
      </div>
      <div className="pc-read" aria-live="polite">
        {h ? <>
          <span title={formatDate(h.departureTime)}><span className="dim">Depart</span> <b className="pl-num">{shortDate(h.departureTime)}</b></span>
          <span title={formatDate(h.arrivalTime)}><span className="dim">Arrive</span> <b className="pl-num">{shortDate(h.arrivalTime)}</b></span>
          <span title={formatDuration(h.timeOfFlight)}><span className="dim">Flight</span> <b className="pl-num">{shortDuration(h.timeOfFlight)}</b></span>
          <span title={`Departure ${dvText(h.departureDv)} + capture ${dvText(h.captureDv)}`}><span className="dim">Δv</span> <b className="pl-num">{dvText(h.totalDv)}</b> <span className="dim pl-num">{Math.round(h.departureDv)}+{Math.round(h.captureDv)}</span></span>
        </> : <span className="dim">{hover !== null ? 'No solution in this cell' : 'Hover a cell for details · click to plan it'}</span>}
      </div>
      {progress && <div role="status" className="mp-prog" title={progress.phase}>
        <span className="mp-prog-phase">{progress.phase}</span>
        <span className="pl-num">{Math.round(progress.fraction * 100)}%</span>
        <button className="btn ghost small pl-icon" aria-label="Cancel planning" title="Cancel (completed cells remain)" onClick={() => { cancel(); setMessage('Planning cancelled. Completed cells remain available.'); }}>×</button>
        <progress aria-label="Transfer window progress" value={progress.fraction} max={1} />
      </div>}
      {message && <div className="mp-msg">{message}</div>}
    </div>
  </div>, document.body);
}
