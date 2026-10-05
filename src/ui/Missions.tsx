import { Button, Card, EmptyState } from './components';
import { useState } from 'react';
import { game } from '../game/store';
import { openProgram, saveProgram } from '../game/program';
import './progression.css';
export default function Missions() {
  const [world] = useState(openProgram);
  const [, refresh] = useState(0);
  const p = world.progression;
  const update = (fn: () => void) => { fn(); saveProgram(world); refresh(n => n + 1); };
  return <main className="program-screen">
    <header className="program-header"><div><div className="label">Coastal Launch Complex · Expedition desk</div><h1>Mission Control</h1><p>Accept a commission. Advance the program. Bring your discoveries home.</p></div>
      <div className="program-balance"><strong>{p.funds.toLocaleString()}</strong><span className="label">credits · {p.reputation} reputation</span></div>
      <Button className="btn" onClick={() => { saveProgram(world); game.set({ scene: 'spaceCenter' }); }}>Space Center</Button>
    </header>
    {world.mode !== 'career' ? <EmptyState title="Build a funded space program">Contracts and program finances are available in Career mode.</EmptyState> : <>
      <div className="program-tabs"><span className="label">{p.contracts.filter(c => c.status === 'active').length} / 3 active commissions</span>
        <Button className="btn" disabled={p.contracts.some(c => c.status === 'offered')} onClick={() => update(() => world.refreshContracts())}>Request new offers</Button></div>
      <section className="mission-grid">{p.contracts.map(c => <Card key={c.id} className={`mission-card panel ${c.status}`}>
        <div className="label">{c.status} · {c.kind === 'return' ? 'Surface expedition' : c.kind === 'orbit' ? 'Orbital operations' : 'Field research'}</div>
        <h2>{c.title}</h2><p>{c.kind === 'orbit' ? 'Establish a stable orbit with periapsis above atmosphere and terrain.' : c.kind === 'return' ? 'Land on the target body, then recover hardware from that expedition on Earth.' : `Run a biome-dependent experiment in ${c.biome} on ${world.universe.body(c.body).name}.`}</p>
        {c.kind === 'return' && c.status === 'active' && <p className="mission-progress">{c.landed ? '✓ Surface objective achieved · Earth recovery pending' : '○ Landing pending · ○ Earth recovery pending'}</p>}
        <dl><div><dt>Advance</dt><dd>{c.advance.toLocaleString()} cr</dd></div><div><dt>Completion</dt><dd>{c.reward.toLocaleString()} cr · +{c.reputation} rep</dd></div><div><dt>Failure / abandonment</dt><dd>−{c.penalty.toLocaleString()} cr · −{c.reputation} rep</dd></div></dl>
        <p className="label">{c.deadline ? `${Math.max(0, (c.deadline - world.ut) / 86400).toFixed(0)} days remaining` : '20-year deadline from acceptance'}</p>
        {c.status === 'offered' && <Button className="btn primary" disabled={p.contracts.filter(c => c.status === 'active').length >= 3} onClick={() => update(() => { world.acceptContract(c.id); })}>Accept commission</Button>}
        {c.status === 'active' && <Button className="btn" onClick={() => update(() => { world.abandonContract(c.id); })}>Abandon · −{c.penalty.toLocaleString()} cr</Button>}
        {c.status === 'completed' && <span className="mission-progress">✓ Reward credited</span>}
      </Card>)}</section>
    </>}
  </main>;
}
