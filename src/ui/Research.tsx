import { Button } from './components';
import { useEffect, useRef, useState } from 'react';
import { SceneHeader } from './nav/SceneHeader';
import { arrowNav } from './nav/arrowNav';
import { openProgram, saveProgram } from '../game/program';
import { TECH_NODES } from '../data/technology';
import { PART_CATALOG } from '../data/parts';
import { EXPERIMENTS } from '../sim/science/experiments';
import { defaultTechSelection } from './researchView';
import './progression.css';

export default function Research() {
  const [world] = useState(openProgram);
  const [, refresh] = useState(0);
  const p = world.progression;
  const unlocked = (id: string) => world.mode === 'sandbox' || p.unlocked.includes(id);
  const [selected, select] = useState(() => defaultTechSelection(TECH_NODES, unlocked, p.science));
  const [archive, showArchive] = useState(false);
  const graph = useRef<HTMLDivElement>(null);
  const node = TECH_NODES.find(n => n.id === selected)!;
  const canResearch = (n: typeof node) => n.requires.every(unlocked) && p.science >= n.cost && !unlocked(n.id);
  const research = (n: typeof node) => { if (!canResearch(n)) return; world.unlockTech(n.id); saveProgram(world); refresh(k => k + 1); };
  const xy = (n: typeof node) => ({ x: 24 + n.column * 188, y: 20 + n.row * 86 });
  const researched = TECH_NODES.filter(n => unlocked(n.id)).length;
  // Keyboard users land on the suggested node: arrows walk the graph, Enter researches.
  useEffect(() => { if (!archive) graph.current?.querySelector<HTMLElement>('.tech-node.selected')?.focus({ preventScroll: false }); }, [archive]);
  const openPart = (id: string) => { saveProgram(world); void import('./Spacepedia').then(m => m.openPedia('research', { kind: 'part', id })); };
  return <main className="program-screen">
    <SceneHeader scene="research" kicker={`Coastal Launch Complex · ${world.mode}`} title="Research Lab" subtitle="Follow a question. Build the instrument. Open the next frontier."
      onLeave={() => saveProgram(world)} aside={<div className="program-balance"><strong>{p.science.toFixed(1)}</strong><span className="label">available science</span></div>} />
    <nav className="program-tabs"><div className="seg" role="group" aria-label="Research view">
      <Button className={!archive ? 'on' : ''} aria-pressed={!archive} onClick={() => showArchive(false)}>Technology · {researched} / {TECH_NODES.length}</Button>
      <Button className={archive ? 'on' : ''} aria-pressed={archive} onClick={() => showArchive(true)}>Science archive · {Object.keys(p.archive).length} subjects</Button>
    </div></nav>
    {archive ? <section className="program-archive panel">
      <h2>Collected knowledge</h2><p>Recorded data earns credit when transmitted or recovered. The archive shows credited science.</p>
      {!Object.keys(p.archive).length ? <p>No observations yet. Fit an Ember probe, or run crew observations from a command pod.</p> :
        <table><thead><tr><th>Experiment</th><th>Body / biome</th><th>Situation</th><th>Runs</th><th>Science</th></tr></thead><tbody>{Object.entries(p.archive).map(([id, a]) => <tr key={id}><td>{EXPERIMENTS.find(e => e.id === a.experiment)?.name}</td><td>{world.universe.body(a.body).name} · {a.biome}</td><td>{a.situation}</td><td>{a.runs}</td><td>{a.science.toFixed(1)}</td></tr>)}</tbody></table>}
    </section> : <>
      <div className="research-layout">
        <section className="research-scroll panel" aria-label="Technology graph">
          <div className="research-graph" ref={graph} onKeyDown={e => arrowNav(e, '.tech-node')}>
            <svg width="960" height="550" aria-hidden="true">{TECH_NODES.flatMap(n => n.requires.map(id => {
              const a = xy(TECH_NODES.find(n => n.id === id)!), b = xy(n);
              return <path key={`${id}-${n.id}`} d={`M${a.x + 164},${a.y + 36} C${a.x + 177},${a.y + 36} ${b.x - 22},${b.y + 36} ${b.x},${b.y + 36}`} fill="none" stroke={unlocked(n.id) ? '#59c5c2' : '#344c64'} strokeWidth="2" />;
            }))}</svg>
            {TECH_NODES.map(n => {
              const pos = xy(n), done = unlocked(n.id), ready = !done && n.requires.every(unlocked), affordable = ready && p.science >= n.cost;
              return <Button key={n.id} className={`tech-node ${done ? 'unlocked' : ready ? 'ready' : 'locked'} ${affordable ? 'affordable' : ''} ${selected === n.id ? 'selected' : ''}`} style={{ left: pos.x, top: pos.y }}
                onFocus={() => select(n.id)} onClick={() => select(n.id)} aria-pressed={selected === n.id}
                onKeyDown={e => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); select(n.id); research(n); } }}>
                <span>{n.name}</span><small>{done ? 'RESEARCHED' : `${n.cost} SCIENCE`} · {n.parts.length} parts</small>
              </Button>;
            })}
          </div>
        </section>
        <aside className="research-detail panel"><div className="label">Technology dossier</div><h2>{node.name}</h2>
          <p>{node.requires.length ? `Requires ${node.requires.map(id => TECH_NODES.find(n => n.id === id)!.name).join(', ')}` : 'Your starting equipment for the first observations and flights.'}</p>
          <Button className="btn primary" disabled={!canResearch(node)} onClick={() => research(node)}>{unlocked(node.id) ? 'Researched' : <>Research · {node.cost} science {canResearch(node) && <span className="kbd">Enter</span>}</>}</Button>
          {!unlocked(node.id) && <p className="research-status">{!node.requires.every(unlocked) ? 'Complete the preceding research first.' : p.science < node.cost ? `${(node.cost - p.science).toFixed(1)} more science needed.` : 'Ready to research.'}</p>}
          <h3>Unlocks {node.parts.length} parts</h3>
          <ul className="research-parts">{node.parts.map(id => <li key={id}><button type="button" className="link-button" title="Open in Spacepedia" onClick={() => openPart(id)}>{PART_CATALOG.get(id)?.name}</button></li>)}</ul>
        </aside>
      </div>
      <p className="program-note"><span className="kbd">←↑↓→</span> move between nodes · <span className="kbd">Enter</span> research the selected node · click a part to read its Spacepedia entry. Transmit field data or recover it on Earth to fund your next discovery.</p>
    </>}
  </main>;
}
