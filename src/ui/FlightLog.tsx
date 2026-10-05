import { useEffect, useRef, useState } from 'react';
import { game } from '../game/store';
import { openProgram } from '../game/program';
import { ACHIEVEMENTS } from '../game/flightlog/achievements';
import { loadAchievements } from '../game/flightlog/storage';
import { eventLabel, orderedSamples, summaryText, type FlightRecord } from '../game/flightlog/recorder';
import './flightlog.css';

function Chart({ record, title, y, x = 0, unit }: { record: FlightRecord; title: string; y: number; x?: number; unit: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const data = orderedSamples(record).filter(s => typeof s[x] === 'number' && typeof s[y] === 'number');
    ctx.clearRect(0, 0, c.width, c.height);
    const left = 66, right = 580, top = 22, bottom = 174;
    const xs = data.map(s => s[x] as number), ys = data.map(s => s[y] as number);
    const minX = Math.min(0, ...xs), maxX = Math.max(1, ...xs), minY = Math.min(0, ...ys), maxY = Math.max(1, ...ys);
    ctx.font = '11px monospace'; ctx.fillStyle = '#8b98ad';
    for (let i = 0; i <= 4; i++) {
      const h = top + (bottom - top) * i / 4;
      ctx.strokeStyle = '#243247'; ctx.beginPath(); ctx.moveTo(left, h); ctx.lineTo(right, h); ctx.stroke();
      ctx.fillText((maxY - (maxY - minY) * i / 4).toLocaleString(undefined, { maximumFractionDigits: 1 }), 4, h + 4);
    }
    ctx.fillText(`${Math.round(minX).toLocaleString()} ${x ? 'm' : 's'}`, left, 198);
    ctx.textAlign = 'right'; ctx.fillText(`${Math.round(maxX).toLocaleString()} ${x ? 'm' : 's'}`, right, 198); ctx.textAlign = 'left';
    ctx.strokeStyle = '#5cc8ff'; ctx.lineWidth = 2; ctx.beginPath();
    data.forEach((s, i) => {
      const px = left + ((s[x] as number) - minX) / (maxX - minX) * (right - left);
      const py = bottom - ((s[y] as number) - minY) / (maxY - minY) * (bottom - top);
      if (!i || s[14] !== data[i - 1][14]) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }); ctx.stroke();
    if (!data.length) ctx.fillText('No telemetry samples yet', 100, 95);
  }, [record, x, y]);
  return <figure className="panel"><figcaption>{title} · {unit}</figcaption><canvas ref={canvas} width={600} height={210} role="img" aria-label={`${title}, ${record.samples.length} samples. Maximum ${unit === 'g' ? record.stats.maxG.toFixed(2) : y === 1 ? Math.round(record.stats.maxAltitude) : Math.round(record.stats.maxSpeed)} ${unit}`} /></figure>;
}
export function FlightReport({ record }: { record: FlightRecord }) {
  const [share, setShare] = useState(false);
  const stats = [['Maximum altitude', `${Math.round(record.stats.maxAltitude).toLocaleString()} m`], ['Maximum speed', `${Math.round(record.stats.maxSpeed).toLocaleString()} m/s`], ['Maximum g-load', `${record.stats.maxG.toFixed(2)} g`], ['Δv spent', `${Math.round(record.stats.dvSpent).toLocaleString()} m/s`], ['Distance travelled', `${Math.round(record.stats.distance).toLocaleString()} m`], ['Bodies visited', record.bodies.join(', ')]];
  return <article className="flight-report"><div className="report-heading"><div><div className="label">{record.outcome ?? 'Flight in progress'} · {Math.round((record.end ?? record.last?.ut ?? record.start) - record.start).toLocaleString()} seconds</div><h2>{record.name}</h2></div><button className="btn" onClick={() => setShare(!share)}>Share summary</button></div>
    {share && <label>Copy this flight summary<textarea readOnly value={summaryText(record)} onFocus={e => e.currentTarget.select()} /></label>}
    <dl className="report-stats">{stats.map(([name, value]) => <div className="panel" key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    <div className="report-charts"><Chart record={record} title="Altitude vs time" y={1} unit="m" /><Chart record={record} title="Surface velocity vs time" y={2} unit="m/s" /><Chart record={record} title="Ascent profile · altitude vs downrange" y={1} x={13} unit="m" /><Chart record={record} title="G-load vs time" y={9} unit="g" /></div>
    <h3>Event timeline</h3><ol className="report-events">{record.events.map((e, i) => <li key={i}><span className="mono">T+{e.time.toFixed(1)} s</span><strong>{eventLabel(e.kind)}</strong><span>{e.body}{e.detail && ` · ${e.detail}`}{e.speed !== undefined && ` · ${e.speed.toFixed(2)} m/s`}{e.biome && ` · ${e.biome}`}</span></li>)}</ol>
    <p className="label">Live charts retain the latest 1,024 samples; completed reports retain up to 128 of those samples. Event history retains the latest 256 events. Peak statistics cover the whole flight. Distance and downrange integrate sampled surface-relative speed.</p>
  </article>;
}
export function AchievementsPanel() {
  const profile = loadAchievements();
  return <div><h2>Achievements · {Object.keys(profile.unlocked).length} / {ACHIEVEMENTS.length}</h2><div className="achievement-grid">{ACHIEVEMENTS.map(a => <div className={`panel achievement ${profile.unlocked[a.id] !== undefined ? 'earned' : ''}`} key={a.id}><div className="label">{profile.unlocked[a.id] !== undefined ? '✓ Earned' : '○ Awaiting flight'}</div><h3>{a.name}</h3><p>{a.description}</p></div>)}</div></div>;
}
export default function FlightLog() {
  const [world] = useState(openProgram);
  const [tab, setTab] = useState<'history' | 'achievements'>('history');
  const [selected, setSelected] = useState(() => world.latestReportId ?? world.flightlog.records.at(-1)?.id);
  const record = world.flightlog.records.find(r => r.id === selected);
  return <div className="fullscreen flight-log"><header><div><div className="label">Mission archive</div><h1>Flight log</h1></div><button className="btn" onClick={() => game.set({ scene: 'spaceCenter' })}>Space Center</button></header><nav><button className="btn" onClick={() => setTab('history')}>Flights · {world.flightlog.records.length}</button><button className="btn" onClick={() => setTab('achievements')}>Achievements</button></nav>
    {tab === 'achievements' ? <AchievementsPanel /> : <div className="flight-log-layout"><aside className="panel">{[...world.flightlog.records].reverse().map(r => <button className={`btn ${selected === r.id ? 'primary' : ''}`} key={r.id} onClick={() => setSelected(r.id)}>{r.name}<small>{r.outcome ?? 'In progress'} · {r.bodies.join(', ')}</small></button>)}{!world.flightlog.records.length && <p>No flights recorded yet. Launch a vessel to begin your archive.</p>}</aside>{record ? <FlightReport key={record.id} record={record} /> : <p>Your flights, charts and milestones will appear here.</p>}</div>}
  </div>;
}
