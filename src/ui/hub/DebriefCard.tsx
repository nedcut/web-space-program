import { useEffect, useRef } from 'react';
import { formatDistance, formatDuration } from '../../util/format';
import { Button, Kbd } from '../components';
import { arrowNav, focusFirst } from '../nav/arrowNav';
import { useEscape } from '../nav/escape';
import type { FlightDebrief } from './debrief';

const signed = (n: number, digits = 0) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** Post-flight summary on the hub. Esc (or Dismiss) closes it; the full report is one click away. */
export function DebriefCard({ debrief: d, onOpenLog, onLaunchAgain, onDismiss }: {
  debrief: FlightDebrief; onOpenLog: () => void; onLaunchAgain: (() => void) | null; onDismiss: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEscape(onDismiss, true, 'panel');
  useEffect(() => focusFirst(ref.current), []);
  const rows: [string, string][] = [
    ['Max altitude', formatDistance(d.maxAltitude)],
    ...(d.furthest ? [['Furthest', d.furthest] as [string, string]] : []),
    ['Flight time', formatDuration(d.duration)],
    ...(d.science !== null && Math.abs(d.science) > 0.05 ? [['Science', signed(d.science, 1)] as [string, string]] : []),
    ...(d.funds !== null && Math.abs(d.funds) >= 1 ? [['Credits', `${signed(Math.round(d.funds))} cr`] as [string, string]] : []),
    ...(d.reputation !== null && Math.abs(d.reputation) >= 0.5 ? [['Reputation', signed(Math.round(d.reputation))] as [string, string]] : []),
    ...(d.recoveryValue !== null ? [['Recovery value', `${Math.round(d.recoveryValue).toLocaleString()} cr`] as [string, string]] : []),
  ];
  return (
    <section ref={ref} className={`panel hub-debrief ${d.outcome}`} aria-label="Flight debrief" onKeyDown={e => arrowNav(e)}>
      <div className="label">{d.kicker}</div>
      <h3>{d.name}</h3>
      <p className="hub-debrief-status">{d.status}</p>
      <dl className="hub-debrief-stats">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>)}</dl>
      {d.crew.length > 0 && <p className="hub-debrief-crew"><span className="label">Crew</span> {d.crew.join(', ')}</p>}
      {d.note && <p className="hub-debrief-note" role="status">{d.note}</p>}
      <div className="hub-debrief-actions">
        <Button className="btn primary" onClick={onOpenLog}>Open Flight Log</Button>
        {onLaunchAgain && <Button className="btn" onClick={onLaunchAgain}>Launch again</Button>}
        <Button className="btn ghost" onClick={onDismiss}>Dismiss <Kbd>Esc</Kbd></Button>
      </div>
    </section>
  );
}
