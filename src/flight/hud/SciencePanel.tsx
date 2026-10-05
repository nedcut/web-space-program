import { useState } from 'react';
import type { World } from '../../game/world';
import { EXPERIMENTS } from '../../sim/science/experiments';
export function SciencePanel({ world, paused }: { world: World; paused: boolean }) {
  const [review, setReview] = useState(false);
  const [, refresh] = useState(0);
  const v = world.active;
  if (!v) return null;
  const context = world.scienceContext(v)!;
  const data = v.state.parts.flatMap(p => p.scienceData ?? []);
  const connected = !world.commsSettings.enabled || world.connection(v.state).connected;
  const transmitting = world.transmitting.includes(v.state.id);
  const antenna = v.state.parts.some(p => p.def.modules.some(m => m.type === 'antenna'));
  const action = (fn: () => unknown) => { if (!paused) fn(); refresh(n => n + 1); };
  return <div className="panel" style={{ padding: 10, pointerEvents: 'auto', maxHeight: 320, overflowY: 'auto', flexShrink: 0 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="label">Science</span><span className="mono" style={{ fontSize: 12 }}>{world.progression.science.toFixed(1)}</span></div>
    <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4 }}>{context.biome} · {context.situation}</div>
    {<>
      <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}><button className="btn small" disabled={paused || !antenna || !data.length || !connected || transmitting} title={!antenna ? 'An antenna is required' : 'Credit the antenna’s fraction; recover for the balance'} onClick={() => action(() => world.transmitScience())}>{transmitting ? (connected ? 'Sending…' : 'Paused · no signal') : connected ? 'Transmit' : 'No signal'}</button><button className="btn small" onClick={() => setReview(!review)}>Review · {data.length}</button></div>
      {!antenna && <p style={{ fontSize: 11 }}>No antenna · recover on Earth for full science.</p>}
      {review ? data.map(d => <div key={d.id} style={{ borderTop: '1px solid #344457', padding: '8px 0', fontSize: 11 }}><strong>{EXPERIMENTS.find(e => e.id === d.experiment)?.name}</strong><div>{d.body} · {d.biome} · {d.situation}</div><div>{d.credited.toFixed(1)} credited / {d.value.toFixed(1)} total</div></div>) : world.scienceInstruments(v).map(i => <div key={`${i.uid}-${i.experiment}`} style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '10px 0' }}><div style={{ flex: 1, fontSize: 12 }}>{i.name}<div style={{ color: 'var(--text-dim)', fontSize: 10 }}>{i.part}</div></div><button className="btn small" disabled={paused || !i.available || i.recorded || !world.canControl(v.state)} title={!i.available ? 'Unavailable in this situation' : i.recorded ? 'Data already aboard' : 'Record experiment'} onClick={() => action(() => world.runExperiment(i.uid, i.experiment))}>{i.recorded ? 'Stored' : 'Run'}</button></div>)}
      {!review && !world.scienceInstruments(v).length && <p style={{ fontSize: 11 }}>Fit science instruments or bring a crew.</p>}
      {review && !data.length && <p style={{ fontSize: 11 }}>No data aboard. Run an instrument to record observations.</p>}
    </>}
  </div>;
}
