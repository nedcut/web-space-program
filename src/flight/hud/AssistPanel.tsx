import { useState } from 'react';
import { ASSIST_LABELS, type AssistId } from '../assist';

/** Collapsible flight-assist menu (top-left, under the time bar). */
export function AssistPanel({ active, onStart, onCancel }: { active: { name: string; status: string } | null; onStart(id: AssistId): void; onCancel(): void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel" style={{ position: 'absolute', top: 64, left: 10, padding: 8, width: 210 }}>
      {active ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="label" style={{ color: 'var(--accent)' }}>Assist · {active.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{active.status}</div>
          <button className="btn small danger" onClick={onCancel}>Cancel (or steer manually)</button>
        </div>
      ) : (
        <>
          <button className="btn small ghost" style={{ width: '100%', textAlign: 'left' }} onClick={() => setOpen((o) => !o)}>
            {open ? '▾' : '▸'} Flight assist
          </button>
          {open && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              {(Object.keys(ASSIST_LABELS) as AssistId[]).map((id) => (
                <button key={id} className="btn small" onClick={() => { onStart(id); setOpen(false); }}>{ASSIST_LABELS[id]}</button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
