import type { World } from '../../game/world';
import { updateSettings, useGame } from '../../game/store';

export function SignalPanel({ world }: { world: World }) {
  const overlay = useGame(s => s.settings.commsOverlay);
  const c = world.commsSettings.enabled ? world.connection() : null;
  const names = c?.path.map(id => world.comms.nodes.find(n => n.id === id)?.name ?? id) ?? [];
  const bars = c?.connected ? Math.max(1, Math.ceil(c.strength * 4)) : 0;
  return <section className="panel" aria-label="Communications status" style={{ position: 'absolute', right: 12, top: 100, width: 240, padding: 10, pointerEvents: 'auto', fontSize: 12 }}>
    <strong style={{ color: c && !c.connected ? 'var(--warn)' : 'var(--accent)' }}>
      <span aria-hidden="true">{'▰'.repeat(bars)}{'▱'.repeat(4 - bars)} </span>
      {!c ? 'Network disabled' : c.connected ? `Signal ${Math.round(c.strength * 100)}%` : 'No signal'}
    </strong>
    {c?.connected && <><div style={{ marginTop: 5 }}>{names.join(' → ')}</div><div>One-way delay {c.delay.toFixed(3)} s</div></>}
    {c && !c.connected && <div>{world.canControl() ? 'Local control available' : 'Probe control limited · SAS holds'}</div>}
    {c && <label style={{ display: 'block', marginTop: 6 }}><input type="checkbox" checked={overlay} onChange={e => updateSettings({ commsOverlay: e.target.checked })} /> Map links · red weak / green strong</label>}
  </section>;
}
