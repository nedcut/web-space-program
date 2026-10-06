import { ASSIST_LABELS, type AssistId } from '../assist';

const ASSIST_HINTS: Record<AssistId, string> = {
  orbit: 'Flies the ascent and circularizes in a low orbit. Stages automatically.',
  node: 'Points at the next maneuver node and burns it.',
  land: 'Suicide-burn landing below the current position.',
  circAp: 'Plans and burns a circularization at apoapsis.',
  circPe: 'Plans and burns a circularization at periapsis.',
};

/** Flight-assist programs (the Flight assist app in the HUD toolbar). */
export function AssistPanel({ active, onStart, onCancel }: { active: { name: string; status: string } | null; onStart(id: AssistId): void; onCancel(): void }) {
  return (
    <div className="panel" style={{ padding: 8, flexShrink: 0 }}>
      {active ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="label" style={{ color: 'var(--accent)' }}>Assist · {active.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{active.status}</div>
          <button className="btn small danger" onClick={onCancel}>Cancel (or steer manually)</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="label">Flight assist</div>
          {(Object.keys(ASSIST_LABELS) as AssistId[]).map((id) => (
            <button key={id} className="btn small" title={ASSIST_HINTS[id]} onClick={() => onStart(id)}>{ASSIST_LABELS[id]}</button>
          ))}
        </div>
      )}
    </div>
  );
}
