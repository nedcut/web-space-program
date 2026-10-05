import { useEffect, useRef, useState } from 'react';
import type { World } from '../../game/world';
import { porkchopGrid, planInterplanetaryTransfer, type PorkchopPoint } from '../../game/interplanetary';
import { formatDate, formatDuration } from '../../ui/format';

const N = 36;
export function TransferWindow({ world, target, onClose, onPlanned }: { world: World; target: string; onClose(): void; onPlanned(message: string): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [grid, setGrid] = useState<(PorkchopPoint | null)[]>([]);
  const [hover, setHover] = useState<PorkchopPoint | null>(null);
  const [message, setMessage] = useState('Calculating transfer windows…');
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<{ start: number; span: number; minFlight: number; maxFlight: number } | null>(null);
  useEffect(() => {
    // Yield once so the modal paints before the synchronous Lambert grid.
    const timer = window.setTimeout(() => {
      try {
        const from = world.active!.body, a = world.universe.body(from), b = world.universe.body(target), mu = world.universe.body(world.universe.sunId).gm;
        const na = Math.sqrt(mu / a.orbit!.a ** 3), nb = Math.sqrt(mu / b.orbit!.a ** 3);
        const tof = Math.PI * Math.sqrt(((a.orbit!.a + b.orbit!.a) / 2) ** 3 / mu);
        const r = { start: world.ut + 600, span: 2 * Math.PI / Math.abs(na - nb), minFlight: tof * 0.65, maxFlight: tof * 1.35 };
        setRange(r);
        setGrid(porkchopGrid(world, from, target, { min: r.start, max: r.start + r.span, samples: N }, { min: r.minFlight, max: r.maxFlight, samples: N }));
        setMessage('Hover for details. Click a cell to verify and plan its transfer.');
      } catch (e) { setMessage((e as Error).message); }
    }, 30);
    return () => clearTimeout(timer);
  }, [world, target]);
  useEffect(() => {
    const g = canvas.current?.getContext('2d');
    if (!g || !grid.length) return;
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
  const plan = (p: PorkchopPoint | null) => {
    if (!p || busy || !range) return;
    setBusy(true); setMessage('Verifying encounter and parking-orbit ejection…');
    window.setTimeout(() => {
      try {
        const old = [...world.nodes];
        const result = planInterplanetaryTransfer(world, target, {
          departureRange: { min: Math.max(world.ut + 300, p.departureTime - range.span / (N - 1) / 2), max: p.departureTime + range.span / (N - 1) / 2, samples: 5 },
          timeOfFlightRange: { min: Math.max(1, p.timeOfFlight - (range.maxFlight - range.minFlight) / (N - 1) / 2), max: p.timeOfFlight + (range.maxFlight - range.minFlight) / (N - 1) / 2, samples: 5 },
        });
        if (result) {
          world.nodes = [result.node]; onPlanned(`Transfer planned: ${result.dv.toFixed(0)} m/s`); onClose();
        } else { world.nodes = old; setMessage('No verified encounter in this cell. Choose a neighbouring window.'); }
      } catch (e) { setMessage((e as Error).message); }
      setBusy(false);
    }, 30);
  };
  return <div className="transfer-modal" role="dialog" aria-modal="true" aria-label="Transfer window" onKeyDown={e => { if (e.key === 'Escape' && !busy) onClose(); }}>
    <div className="panel transfer-plot">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="label">Transfer window · {world.universe.body(target).name}</span><button className="btn small" disabled={busy} onClick={onClose}>Close</button></div>
      <div className="label">Flight time ↑ · departure date →</div>
      <canvas ref={canvas} width={648} height={360} aria-label="Departure date versus flight time, total delta-v colour map" onMouseMove={e => setHover(cell(e))} onMouseLeave={() => setHover(null)} onClick={e => plan(cell(e))} />
      {range && <div className="mono" style={{ fontSize: 11 }}>{formatDate(range.start)} → {formatDate(range.start + range.span)} · flight {formatDuration(range.minFlight)}–{formatDuration(range.maxFlight)}</div>}
      <div style={{ background: 'linear-gradient(90deg,blue,cyan,lime,yellow,red)', height: 8, borderRadius: 3 }} />
      <div className="label">Blue: lower Δv · red: higher Δv · dark: no solution</div>
      <div className="mono" style={{ minHeight: 40, fontSize: 12 }}>{hover ? `Depart ${formatDate(hover.departureTime)} · fly ${formatDuration(hover.timeOfFlight)} · Δv ${hover.totalDv.toFixed(0)} m/s (departure ${hover.departureDv.toFixed(0)} + capture ${hover.captureDv.toFixed(0)})` : 'Grid estimates include circular capture. Click plans a verified encounter within the selected cell.'}</div>
      <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>{message}</div>
    </div>
  </div>;
}
