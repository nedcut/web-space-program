import { Button, Card, ConfirmModal, EmptyState } from './components';
import { careerScaleMultiplier } from '../sim/bodies/scale';
import { useState } from 'react';
import { SceneHeader } from './nav/SceneHeader';
import { openProgram, saveProgram } from '../game/program';
import { MISSION_FILTERS, contractCounts, visibleContracts, type MissionFilter } from './missionsView';
import type { Contract } from '../sim/science/progression';
import './progression.css';

const MAX_ACTIVE = 3;
const FILTER_LABELS: Record<MissionFilter, string> = { open: 'Open', all: 'All', active: 'Active', offered: 'Offered', completed: 'Completed', failed: 'Declined / failed' };
const KIND_LABELS: Record<Contract['kind'], string> = { return: 'Surface expedition', flyby: 'Lunar reconnaissance', orbit: 'Orbital operations', science: 'Field research' };

/** What to do, in player terms: which hardware counts and where. */
function contractBrief(c: Contract, bodyName: string): string {
  switch (c.kind) {
    case 'flyby': return `Fly any vessel into the ${bodyName}'s sphere of influence. Plan the transfer from a parking orbit; landing and recovery are optional.`;
    case 'orbit': return `Reach a stable orbit around ${bodyName}: periapsis above the atmosphere and terrain.`;
    case 'return': return c.body === 'earth'
      ? 'Fly any crewed or uncrewed vessel, come down on land or water anywhere on Earth, and recover it.'
      : `Land on ${bodyName}, then bring that expedition's hardware home and recover it on Earth.`;
    case 'science': return c.biome === 'Launch Complex'
      ? 'Run the thermometer (or another surface experiment) at the launch complex: on the pad counts.'
      : `Run the thermometer or another surface experiment in ${c.biome} on ${bodyName}: landed, splashed down or flying low over it.`;
  }
}

/** Declined offers are stored as failed contracts that were never accepted (no deadline, no penalty). */
const declined = (c: Contract) => c.status === 'failed' && c.deadline === undefined;

export default function Missions() {
  // Opening the desk fills it when it is clear (or the program's capability has moved on since the offers).
  const [world] = useState(() => { const w = openProgram(); if (w.refreshContracts()) saveProgram(w); return w; });
  const [, refresh] = useState(0);
  const [filter, setFilter] = useState<MissionFilter>('open');
  const [abandoning, setAbandoning] = useState<Contract | null>(null);
  const p = world.progression;
  const update = (fn: () => void) => { fn(); saveProgram(world); refresh(n => n + 1); };
  const counts = contractCounts(p.contracts);
  const shown = visibleContracts(p.contracts, filter);
  const grantFloor = 8000 * careerScaleMultiplier(world.universe.preset);
  const full = counts.active >= MAX_ACTIVE;
  return <main className="program-screen">
    <SceneHeader scene="missions" kicker="Coastal Launch Complex · Expedition desk" title="Mission Control" subtitle="Accept a commission. Advance the program. Bring your discoveries home."
      onLeave={() => saveProgram(world)} aside={<div className="program-balance"><strong>{p.funds.toLocaleString()}</strong><span className="label">credits · {p.reputation} reputation</span></div>} />
    {world.mode !== 'career' ? <EmptyState title="Build a funded space program">Contracts and program finances are available in Career mode.</EmptyState> : <>
      <div className="mission-toolbar">
        <div className="seg" role="group" aria-label="Show commissions">{MISSION_FILTERS.filter(f => f !== 'failed' || counts.failed).map(f =>
          <Button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>{FILTER_LABELS[f]} · {counts[f]}</Button>)}</div>
        <span className="label mission-slots">{counts.active} / {MAX_ACTIVE} active</span>
        <div className="mission-actions">
          <Button className="btn" disabled={counts.offered > 0} title={counts.offered ? 'Accept or decline the current offers first' : undefined} onClick={() => update(() => world.refreshContracts())}>Request new offers</Button>
          <Button className="btn" disabled={p.funds >= grantFloor} title={p.funds >= grantFloor ? `Available when credits fall below ${grantFloor.toLocaleString()}` : `Restores ${grantFloor.toLocaleString()} credits for 5 reputation`}
            onClick={() => update(() => { world.requestRecoveryGrant(); })}>Emergency funding · −5 rep</Button>
        </div>
      </div>
      {!shown.length ? <EmptyState title={filter === 'open' || filter === 'all' ? 'No commissions on the desk' : `No ${FILTER_LABELS[filter].toLowerCase()} commissions`}>
        {filter === 'open' || filter === 'all' ? 'Request new offers to fill the desk.' : 'Pick another filter above.'}</EmptyState> :
      <section className="mission-grid">{shown.map(c => <Card key={c.id} className={`mission-card panel ${c.status}`}>
        <div className="label">{declined(c) ? 'declined' : c.status} · {c.kind === 'return' && c.body === 'earth' ? 'Test flight' : KIND_LABELS[c.kind]}</div>
        <h2>{c.title}</h2><p>{contractBrief(c, world.universe.body(c.body).name)}</p>
        {c.kind === 'return' && c.status === 'active' && <p className="mission-progress">{c.landed ? '✓ Surface objective achieved · Earth recovery pending' : '○ Landing pending · ○ Earth recovery pending'}</p>}
        <dl><div><dt>Advance</dt><dd>{c.advance.toLocaleString()} cr</dd></div><div><dt>Completion</dt><dd>{c.reward.toLocaleString()} cr · +{c.reputation} rep</dd></div><div><dt>Failure / abandonment</dt><dd>−{c.penalty.toLocaleString()} cr · −{c.reputation} rep</dd></div></dl>
        <p className="label">{c.status === 'active' && c.deadline ? `${Math.max(0, (c.deadline - world.ut) / 86400).toFixed(0)} days remaining` : c.status === 'offered' ? '20-year deadline from acceptance' : c.status === 'completed' ? '✓ Reward credited' : declined(c) ? 'Offer declined · no penalty' : 'Penalty applied'}</p>
        {c.status === 'offered' && <div className="mission-card-actions">
          <Button className="btn" onClick={() => update(() => { world.abandonContract(c.id); })}>Decline</Button>
          <Button className="btn primary" disabled={full} title={full ? `${MAX_ACTIVE} commissions already active` : undefined} onClick={() => update(() => { world.acceptContract(c.id); })}>Accept · +{c.advance.toLocaleString()} cr</Button>
        </div>}
        {c.status === 'active' && <div className="mission-card-actions"><Button className="btn ghost" onClick={() => setAbandoning(c)}>Abandon…</Button></div>}
      </Card>)}</section>}
    </>}
    {abandoning && <ConfirmModal title={`Abandon “${abandoning.title}”?`} confirmLabel={`Abandon · −${abandoning.penalty.toLocaleString()} cr`} danger
      onCancel={() => setAbandoning(null)} onConfirm={() => { const id = abandoning.id; setAbandoning(null); update(() => { world.abandonContract(id); }); }}>
      The commission fails: you lose {abandoning.penalty.toLocaleString()} credits and {abandoning.reputation} reputation. The advance is not returned.
    </ConfirmModal>}
  </main>;
}
