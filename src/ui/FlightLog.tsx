import { SceneHeader } from './nav/SceneHeader';
import { arrowNav, focusFirst } from './nav/arrowNav';
import { facilityLabel } from './nav/scenes';
import { previousScene } from './nav/sceneHistory';
import { game } from '../game/store';
import { Button, Panel, EmptyState, Badge } from './components';
import { useEffect, useRef, useState } from 'react';
import { openProgram } from '../game/program';
import { ACHIEVEMENTS } from '../game/flightlog/achievements';
import { loadAchievements } from '../game/flightlog/storage';
import { eventLabel, eventDetail, bodyLabel, parentReport, orderedSamples, summaryText, type FlightRecord } from '../game/flightlog/recorder';
import { BODY_DEFS } from '../data/bodies';
import './flightlog.css';

const BODY_NAMES = new Map(BODY_DEFS.map(b => [b.id, b.name]));

function Chart({ record, title, y, x = 0, unit }: { record: FlightRecord; title: string; y: number; x?: number; unit: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const data = orderedSamples(record).filter(s => typeof s[x] === 'number' && typeof s[y] === 'number');
    ctx.clearRect(0, 0, c.width, c.height);
    const left = 66, right = 580, top = 22, bottom = 174;
    const xs = data.map(s => s[x] as number), ys = data.map(s => s[y] as number);
    // Older saves may begin after zero; retain their actual time extent.
    const minX = xs.length ? Math.min(...xs) : 0, maxX = Math.max(1, ...xs), minY = Math.min(0, ...ys), maxY = Math.max(1, ...ys);
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
  const stats = [['Maximum altitude', `${Math.round(record.stats.maxAltitude).toLocaleString()} m`], ['Maximum speed', `${Math.round(record.stats.maxSpeed).toLocaleString()} m/s`], ['Maximum g-load', `${record.stats.maxG.toFixed(2)} g`], ['Δv spent', `${Math.round(record.stats.dvSpent).toLocaleString()} m/s`], ['Distance travelled', `${Math.round(record.stats.distance).toLocaleString()} m`], ['Bodies visited', record.bodies.map(id => BODY_NAMES.get(id) ?? id).join(', ')]];
  return <article className="flight-report"><div className="report-heading"><div><div className="label">{record.outcome ?? 'Flight in progress'} · Record elapsed: {Math.round((record.end ?? record.last?.ut ?? record.start) - record.start).toLocaleString()} seconds</div><h2>{record.name}</h2></div><Button className="btn" onClick={() => setShare(!share)}>Share summary</Button></div>
    {share && <label>Copy this flight summary<textarea readOnly value={summaryText(record)} onFocus={e => e.currentTarget.select()} /></label>}
    <dl className="report-stats">{stats.map(([name, value]) => <Panel className="panel" key={name}><dt>{name}</dt><dd>{value}</dd></Panel>)}</dl>
    <div className="report-charts"><Chart record={record} title="Altitude vs time" y={1} unit="m" /><Chart record={record} title="Surface velocity vs time" y={2} unit="m/s" /><Chart record={record} title="Ascent profile · altitude vs downrange" y={1} x={13} unit="m" /><Chart record={record} title="G-load vs time" y={9} unit="g" /></div>
    <h3>Event timeline · elapsed since record began</h3><p className="label">Elapsed time includes time on the pad and after touchdown. The flight HUD mission clock starts at liftoff.</p><ol className="report-events">{record.events.map((e, i) => <li key={i}><span className="mono">Elapsed {e.time.toFixed(1)} s</span><strong>{eventLabel(e.kind)}</strong><span>{bodyLabel(e.body)}{eventDetail(e) && ` · ${eventDetail(e)}`}{e.speed !== undefined && ` · ${e.speed.toFixed(2)} m/s`}{e.biome && ` · ${e.biome}`}</span></li>)}</ol>
    <p className="label">Charts summarize the whole record with up to 1,024 live samples or 128 saved samples, preserving endpoints, sampled peaks and representative events. Event history retains the latest 256 events. Peak statistics cover the whole flight. Distance and downrange integrate sampled surface-relative speed.</p>
  </article>;
}
export function AchievementsPanel() {
  const profile = loadAchievements();
  return <div><h2>Achievements · {Object.keys(profile.unlocked).length} / {ACHIEVEMENTS.length}</h2><div className="achievement-grid">{ACHIEVEMENTS.map(a => <div className={`panel achievement ${profile.unlocked[a.id] !== undefined ? 'earned' : ''}`} key={a.id}><Badge>{profile.unlocked[a.id] !== undefined ? '✓ Earned' : '○ Awaiting flight'}</Badge><h3>{a.name}</h3><p>{a.description}</p></div>)}</div></div>;
}
export default function FlightLog() {
  const [world] = useState(openProgram);
  const [tab, setTab] = useState<'history' | 'achievements'>('history');
  const [selected, setSelected] = useState(() => world.latestReportId ?? world.flightlog.records.at(-1)?.id);
  // Arriving straight from a flight: offer the way on to the hub and show the recovery summary here
  // (it would otherwise only appear on the hub, one screen later).
  const [fromFlight] = useState(() => previousScene() === 'flight');
  const [notice] = useState(() => fromFlight ? game.get().notice : null);
  const arrival = useRef<HTMLElement>(null);
  useEffect(() => {
    if (notice) game.set({ notice: null });
    if (fromFlight) focusFirst(arrival.current);
  }, [fromFlight, notice]);
  const records = world.flightlog.records;
  const record = records.find(r => r.id === selected);
  const latest = records.find(r => r.id === world.latestReportId);
  const earned = Object.keys(loadAchievements().unlocked).length;
  return <div className="fullscreen flight-log"><SceneHeader scene="flightlog" kicker="Mission archive" title="Flight Log" />
    {fromFlight && <section className="panel flight-arrival" ref={arrival} aria-label="Flight summary">
      <div><div className="label">Back from flight{latest ? ` · ${latest.outcome ?? 'in progress'}` : ''}</div><strong>{latest?.name ?? 'Flight report'}</strong>{notice && <p>{notice}</p>}</div>
      <div className="flight-arrival-actions"><Button className="btn" onClick={() => game.set({ scene: 'editor' })}>{facilityLabel('editor')}</Button>
        <Button className="btn primary" onClick={() => game.set({ scene: 'spaceCenter' })}>Continue to Space Center</Button></div>
    </section>}
    <p className="label">Each vessel has a report. A launch can include its main vessel and separated hardware; all reports remain available below.</p><nav className="flight-log-tabs"><div className="seg" role="group" aria-label="Flight Log view">
      <Button className={tab === 'history' ? 'on' : ''} aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Vessel reports · {records.length}</Button>
      <Button className={tab === 'achievements' ? 'on' : ''} aria-pressed={tab === 'achievements'} onClick={() => setTab('achievements')}>Achievements · {earned} / {ACHIEVEMENTS.length}</Button>
    </div></nav>
    {tab === 'achievements' ? <AchievementsPanel /> : !records.length ? <EmptyState title="Your next story starts on the pad">
      Launch a vessel to begin your archive: flight reports, charts and milestones appear here. <Button className="btn primary flight-log-build" onClick={() => game.set({ scene: 'editor' })}>Open {facilityLabel('editor')}</Button>
    </EmptyState> : <div className="flight-log-layout">
      <aside className="panel" aria-label="Vessel reports" onKeyDown={e => arrowNav(e)}>{[...records].reverse().map(r => <Button className={`btn ${selected === r.id ? 'primary' : ''}`} aria-current={selected === r.id ? 'true' : undefined} key={r.id} onClick={() => setSelected(r.id)}>{r.name}<small>{parentReport(r, records) ? `Separated hardware from ${parentReport(r, records)?.name} · ` : r.launchName && r.launchId !== r.id ? `Separated hardware from ${r.launchName} · ` : ''}{r.outcome ?? 'In progress'} · {r.bodies.map(id => BODY_NAMES.get(id) ?? id).join(', ')}</small></Button>)}</aside>
      {record ? <FlightReport key={record.id} record={record} /> : <EmptyState title="Choose a flight">Select a flight on the left to open its report.</EmptyState>}
    </div>}
  </div>;
}
