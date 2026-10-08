import { useState } from 'react';
import type { World } from '../../game/world';
import { formatCountdown } from '../../util/format';

/** Uses the parent HUD's 10 Hz clock, without its own animation or simulation timer. */
export function AlarmPanel({ world }: { world: World }) {
  const [label, setLabel] = useState('Reminder');
  const [minutes, setMinutes] = useState('5');
  const [vessel, setVessel] = useState(world.activeId ?? '');
  const [, bump] = useState(0);
  const [error, setError] = useState('');
  const clock = world.alarmClock;
  const refresh = () => bump(n => n + 1);
  return <div style={{ display: 'grid', gap: 8, padding: 10 }}>
    <span className="label">Mission alarms · all vessels</span>
    <span className="label">Nodes: 30 s before · SOI changes: at crossing</span>
    {clock.held && <button className="btn small" onClick={() => { clock.acknowledge(); refresh(); }}>Acknowledge · resume warp when ready</button>}
    {[...clock.alarms].sort((a, b) => a.time - b.time).map(a => <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 5 }}>
      <span><strong>{a.disabled ? '○ ' : a.fired ? '✓ ' : ''}{a.label}</strong><br />{world.vessels.get(a.vesselId)?.state.name ?? 'Unavailable vessel'} · {a.fired ? 'Reached' : formatCountdown(a.time - world.ut)}</span>
      {a.kind === 'custom' || a.fired ? <button className="btn ghost small" aria-label={`Remove alarm ${a.label}`} onClick={() => { clock.remove(a.id); refresh(); }}>×</button>
        : <button className="btn ghost small" aria-label={`${a.disabled ? 'Enable' : 'Disable'} alarm ${a.label}`} onClick={() => { clock.toggle(a.id); refresh(); }}>{a.disabled ? 'Enable' : 'Disable'}</button>}
    </div>)}
    {!clock.alarms.length && <span className="label">Nodes and predicted SOI changes create alarms automatically.</span>}
    <select className="btn small" aria-label="Alarm vessel" value={vessel} onChange={e => setVessel(e.target.value)}>
      {[...world.vessels.values()].map(v => <option key={v.state.id} value={v.state.id}>{v.state.name}</option>)}
    </select>
    <input aria-label="Alarm label" value={label} maxLength={80} onChange={e => setLabel(e.target.value)} />
    <label>In <input aria-label="Alarm minutes from now" type="number" min="0.01" step="1" value={minutes} onChange={e => setMinutes(e.target.value)} style={{ width: 70 }} /> minutes</label>
    <button className="btn small" onClick={() => {
      try {
        if (!world.vessels.has(vessel) || !(Number(minutes) > 0)) throw new Error('Choose a vessel and a positive wait');
        clock.add(vessel, label, world.ut + Number(minutes) * 60); setError(''); refresh();
      } catch (e) { setError((e as Error).message); }
    }}>Add alarm</button>
    {error && <span role="alert">{error}</span>}
  </div>;
}
