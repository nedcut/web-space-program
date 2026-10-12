import { Button } from '../ui/components';
import { useEffect, useRef, useState } from 'react';
import { game } from '../game/store';
import { SCENARIOS, type Budget, type Scenario } from './catalog';
import { readBests } from './records';
import { startScenario } from './runtime';
import './scenarios.css';
import { MenuScreenHeader } from '../ui/nav/MenuScreenHeader';
import { arrowNav } from '../ui/nav/arrowNav';
export function budgetText(b: Budget) {
  return [Number.isFinite(b.time) && `≤ ${b.time} s`, `≤ ${b.dv} m/s Δv`, Number.isFinite(b.speed) && `≤ ${b.speed} m/s touchdown`, Number.isFinite(b.precision) && `≤ ${b.precision} m miss`].filter(Boolean).join(' · ');
}
// The last challenge looked at, so returning from a flight lands on the same briefing.
let lastSelected = SCENARIOS[0];
export default function Scenarios() {
  const [selected, select] = useState(lastSelected);
  const [error, setError] = useState('');
  const bests = readBests();
  const list = useRef<HTMLElement>(null);
  useEffect(() => list.current?.querySelector<HTMLElement>('.scenario-card.selected')?.focus({ preventScroll: true }), []);
  const fly = (s = selected) => { try { startScenario(s.id); } catch (e) { setError((e as Error).message); } };
  const choose = (s: Scenario) => { if (s.id !== selected.id) { lastSelected = s; select(s); setError(''); } };
  const medals = SCENARIOS.filter(s => bests[s.id]).length;
  const best = bests[selected.id];
  return <main className="fullscreen scenario-library">
    <MenuScreenHeader onBack={() => game.set({ scene: 'menu' })} kicker="Quick-start expeditions · Standard scale" title="Challenges"
      subtitle={`${SCENARIOS.length} ready-to-fly challenges with medal targets. Four journeys into Saturn’s rings, haze and hidden ocean.`}
      aside={<div className="scenario-medals" aria-label={`Medals earned in ${medals} of ${SCENARIOS.length} challenges`}><strong>{medals} / {SCENARIOS.length}</strong><span className="label">medals earned</span></div>} />
    <div className="scenario-layout"><nav aria-label="Challenges" ref={list} onKeyDown={e => arrowNav(e)}>{SCENARIOS.map((s, i) => <Button key={s.id} className={`panel scenario-card ${selected.id === s.id ? 'selected' : ''}`} aria-pressed={selected.id === s.id}
      onFocus={() => choose(s)} onClick={() => choose(s)} onKeyDown={e => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); choose(s); fly(s); } }}>
      <span className="label">{String(i + 1).padStart(2, '0')} · {s.region}</span><strong>{s.title}</strong><span className={bests[s.id] ? `medal-${bests[s.id].medal}` : ''}>{bests[s.id] ? `${bests[s.id].medal.toUpperCase()} · ${bests[s.id].score.toLocaleString()} points` : 'Not flown yet'}</span>
    </Button>)}<p className="scenario-hint"><span className="kbd">↑↓</span> choose · <span className="kbd">Enter</span> fly</p></nav>
    <article className="panel scenario-briefing"><div className="scenario-orbit" aria-hidden="true">◯</div><div className="label">Briefing · {selected.region}</div><h2>{selected.title}</h2><div className="scenario-actions"><Button className="btn primary" onClick={() => fly()}>Fly challenge</Button>{best && <span className={`scenario-best medal-${best.medal}`}>Your best: {best.medal} · {best.score.toLocaleString()} points</span>}</div>{error && <p role="alert">{error}</p>}<p>{selected.briefing}</p><h3>Flight objective</h3><p>{selected.objective}</p><h3>Your starting state</h3><p>{selected.hint}</p><p className="label">Stock spacecraft · {selected.craft}</p><h3>Medal targets</h3><p><b className="medal-gold">Gold</b> {budgetText(selected.gold)}</p><p><b className="medal-silver">Silver</b> {budgetText(selected.silver)}</p><p><b className="medal-bronze">Bronze</b> Complete the objectives safely.</p><p className="scenario-muted">Δv measures engine and RCS impulse per vessel mass; aerodynamic braking costs no Δv. Scores reward fuel, time, touchdown and precision where applicable. Successful medals and scores are kept on this browser when storage is available.</p><a href={selected.source} target="_blank" rel="noreferrer">Science background · NASA ↗</a></article></div>
  </main>;
}
