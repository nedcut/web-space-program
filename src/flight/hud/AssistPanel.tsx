import { useEffect, useState } from 'react';
import { ASSIST_LABELS, type AssistId, type AssistOptions } from '../assist';
import { DAYLIGHT_ELEVATION, type LandingLight } from '../../game/landingLight';
import { formatDuration } from '../../ui/format';

const ASSIST_HINTS: Record<AssistId, string> = {
  orbit: 'Flies the ascent and circularizes in a low orbit. Stages automatically.',
  node: 'Turns to the next node, warps to it, stages when nothing is thrusting, starts half the burn early and trims to the plan.',
  land: 'Suicide-burn landing below the current position.',
  circAp: 'Plans and burns a circularization at apoapsis.',
  circPe: 'Plans and burns a circularization at periapsis.',
};

/** Polls the touchdown lighting once a second while the panel is open (no cost when it is closed). */
function useLandingLight(read?: () => LandingLight | null): LandingLight | null {
  const [light, setLight] = useState<LandingLight | null>(null);
  useEffect(() => {
    if (!read) return;
    const poll = () => setLight(read());
    poll();
    const id = window.setInterval(poll, 1000);
    return () => window.clearInterval(id);
  }, [read]);
  return read ? light : null;
}

/** Day or night where Land here would touch down, and the wait for a lit touchdown. */
function LandLight({ light, onStart }: { light: LandingLight; onStart(id: AssistId, opts?: AssistOptions): void }) {
  const deg = Math.round((light.elevation * 180) / Math.PI);
  const day = light.elevation >= DAYLIGHT_ELEVATION;
  const word = day ? 'daylight' : light.elevation >= 0 ? 'low sun' : 'night';
  return (
    <div className="assist-light" data-day={day} title="Where the descent would reach the ground if started now, and how high the Sun stands there">
      <span>Touchdown: {word} · Sun {deg}°</span>
      {!day && (light.daylightWait !== null && light.daylightWait > 0
        ? <button className="btn small" title="Coast until a descent started then touches down in daylight, then land" onClick={() => onStart('land', { wait: light.daylightWait! })}>
            Wait {formatDuration(Math.ceil(light.daylightWait))}, land in daylight
          </button>
        : <span className="assist-light-none">No lit touchdown within one orbit</span>)}
    </div>
  );
}

/** Flight-assist programs (the Flight assist app in the HUD toolbar). */
export function AssistPanel({ active, onStart, onCancel, landingLight }: {
  active: { name: string; status: string } | null;
  onStart(id: AssistId, opts?: AssistOptions): void;
  onCancel(): void;
  landingLight?: () => LandingLight | null;
}) {
  const light = useLandingLight(active ? undefined : landingLight);
  return (
    <div className="panel" style={{ padding: 8, flexShrink: 0 }}>
      {active ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="label" style={{ color: 'var(--accent)' }}>Assist · {active.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{active.status}</div>
          <button className="btn small danger" title="Cancel automatic flight control; steering also cancels" onClick={onCancel}>Cancel (or steer manually)</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="label">Flight assist</div>
          {(Object.keys(ASSIST_LABELS) as AssistId[]).map((id) => (
            <div key={id} style={{ display: 'contents' }}>
              <button className="btn small" title={ASSIST_HINTS[id]} onClick={() => onStart(id)}>{ASSIST_LABELS[id]}</button>
              {id === 'land' && light && <LandLight light={light} onStart={onStart} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
