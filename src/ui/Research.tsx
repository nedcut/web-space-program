import { Button } from './components';
import { useState } from 'react';
import { SceneHeader } from './nav/SceneHeader';
import { openProgram, saveProgram } from '../game/program';
import { TECH_NODES } from '../data/technology';
import { PART_CATALOG } from '../data/parts';
import { EXPERIMENTS } from '../sim/science/experiments';
import './progression.css';

export default function Research() {
  const [world] = useState(openProgram);
  const [, refresh] = useState(0);
  const [selected, select] = useState('foundation');
  const [archive, showArchive] = useState(false);
  const p = world.progression, node = TECH_NODES.find(n => n.id === selected)!;
  const unlocked = (id: string) => world.mode === 'sandbox' || p.unlocked.includes(id);
  const available = node.requires.every(unlocked) && p.science >= node.cost && !unlocked(node.id);
  const xy = (n: typeof node) => ({ x: 24 + n.column * 188, y: 20 + n.row * 86 });
  return <main className="program-screen">
    <SceneHeader scene="research" kicker={`Coastal Launch Complex · ${world.mode}`} title="Research Lab" subtitle="Follow a question. Build the instrument. Open the next frontier."
      onLeave={() => saveProgram(world)} aside={<div className="program-balance"><strong>{p.science.toFixed(1)}</strong><span className="label">available science</span></div>} />
    <nav className="program-tabs"><Button className={`btn ${!archive ? 'primary' : ''}`} onClick={() => showArchive(false)}>Technology · 25 nodes</Button><Button className={`btn ${archive ? 'primary' : ''}`} onClick={() => showArchive(true)}>Science archive · {Object.keys(p.archive).length} subjects</Button></nav>
    {archive ? <section className="program-archive panel">
      <h2>Collected knowledge</h2><p>Recorded data earns credit when transmitted or recovered. The archive shows credited science.</p>
      {!Object.keys(p.archive).length ? <p>No observations yet. Fit an Ember probe, or run crew observations from a command pod.</p> :
        <table><thead><tr><th>Experiment</th><th>Body / biome</th><th>Situation</th><th>Runs</th><th>Science</th></tr></thead><tbody>{Object.entries(p.archive).map(([id, a]) => <tr key={id}><td>{EXPERIMENTS.find(e => e.id === a.experiment)?.name}</td><td>{world.universe.body(a.body).name} · {a.biome}</td><td>{a.situation}</td><td>{a.runs}</td><td>{a.science.toFixed(1)}</td></tr>)}</tbody></table>}
    </section> : <>
      <div className="research-layout">
        <section className="research-scroll panel" aria-label="Technology graph">
          <div className="research-graph">
            <svg width="960" height="550" aria-hidden="true">{TECH_NODES.flatMap(n => n.requires.map(id => {
              const a = xy(TECH_NODES.find(n => n.id === id)!), b = xy(n);
              return <path key={`${id}-${n.id}`} d={`M${a.x + 164},${a.y + 36} C${a.x + 177},${a.y + 36} ${b.x - 22},${b.y + 36} ${b.x},${b.y + 36}`} fill="none" stroke={unlocked(n.id) ? '#59c5c2' : '#344c64'} strokeWidth="2" />;
            }))}</svg>
            {TECH_NODES.map(n => { const pos = xy(n), ready = n.requires.every(unlocked); return <Button key={n.id} className={`tech-node ${unlocked(n.id) ? 'unlocked' : ready ? 'ready' : ''} ${selected === n.id ? 'selected' : ''}`} style={{ left: pos.x, top: pos.y }} onClick={() => select(n.id)} aria-pressed={selected === n.id}>
              <span>{n.name}</span><small>{unlocked(n.id) ? 'RESEARCHED' : `${n.cost} SCIENCE`} · {n.parts.length} parts</small>
            </Button>; })}
          </div>
        </section>
        <aside className="research-detail panel"><div className="label">Technology dossier</div><h2>{node.name}</h2>
          <p>{node.requires.length ? `Requires ${node.requires.map(id => TECH_NODES.find(n => n.id === id)!.name).join(', ')}` : 'Your starting equipment for the first observations and flights.'}</p>
          <ul>{node.parts.map(id => <li key={id}>{PART_CATALOG.get(id)?.name}</li>)}</ul>
          <Button className="btn primary" disabled={!available} onClick={() => { world.unlockTech(node.id); saveProgram(world); refresh(n => n + 1); }}>{unlocked(node.id) ? 'Researched' : `Research · ${node.cost} science`}</Button>
          {!unlocked(node.id) && <p>{!node.requires.every(unlocked) ? 'Complete the preceding research first.' : p.science < node.cost ? `${(node.cost - p.science).toFixed(1)} more science needed.` : 'Ready to research.'}</p>}
        </aside>
      </div>
      <p className="program-note">Six research paths · Select a node to inspect its equipment. Transmit field data or recover it on Earth to fund your next discovery.</p>
    </>}
  </main>;
}
