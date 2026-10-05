import { Button } from '../ui/components';
import { useState } from 'react';
import { game } from '../game/store';
import { SCENARIOS, type Budget } from './catalog';
import { readBests } from './records';
import { startScenario } from './runtime';
import './scenarios.css';
export function budgetText(b: Budget) {
  return [Number.isFinite(b.time) && `≤ ${b.time} s`, `≤ ${b.dv} m/s Δv`, Number.isFinite(b.speed) && `≤ ${b.speed} m/s touchdown`, Number.isFinite(b.precision) && `≤ ${b.precision} m miss`].filter(Boolean).join(' · ');
}
export default function Scenarios() {
  const [selected, select] = useState(SCENARIOS[0]);
  const [error, setError] = useState('');
  const bests = readBests();
  return <main className="fullscreen scenario-library">
    <header><div className="label">Quick-start expeditions · Standard scale</div><h1>Missions</h1><p>Ten ready-to-fly challenges. Four journeys into Saturn’s rings, haze and hidden ocean.</p></header>
    <div className="scenario-layout"><nav aria-label="Scenarios">{SCENARIOS.map((s, i) => <Button key={s.id} className={`panel scenario-card ${selected.id === s.id ? 'selected' : ''}`} aria-pressed={selected.id === s.id} onClick={() => { select(s); setError(''); }}>
      <span className="label">{String(i + 1).padStart(2, '0')} · {s.region}</span><strong>{s.title}</strong><span>{bests[s.id] ? `${bests[s.id].medal.toUpperCase()} · ${bests[s.id].score.toLocaleString()} points` : 'Awaiting your first flight'}</span>
    </Button>)}</nav>
    <article className="panel scenario-briefing"><div className="scenario-orbit" aria-hidden="true">◯</div><div className="label">Mission briefing · {selected.region}</div><h2>{selected.title}</h2><div className="scenario-actions"><Button className="btn primary" onClick={() => { try { startScenario(selected.id); } catch (e) { setError((e as Error).message); } }}>Fly mission</Button><Button className="btn" onClick={() => game.set({ scene: 'menu' })}>Main menu</Button></div><p>{selected.briefing}</p><h3>Flight objective</h3><p>{selected.objective}</p><h3>Your starting state</h3><p>{selected.hint}</p><p className="label">Stock spacecraft · {selected.craft}</p><h3>Medal targets</h3><p><b className="medal-gold">Gold</b> {budgetText(selected.gold)}</p><p><b className="medal-silver">Silver</b> {budgetText(selected.silver)}</p><p><b className="medal-bronze">Bronze</b> Complete the objectives safely.</p><p className="scenario-muted">Δv measures engine and RCS impulse per vessel mass; aerodynamic braking costs no Δv. Scores reward fuel, time, touchdown and precision where applicable. Successful medals and scores are kept on this browser when storage is available.</p><a href={selected.source} target="_blank" rel="noreferrer">Science background · NASA ↗</a>{error && <p role="alert">{error}</p>}</article></div>
  </main>;
}
