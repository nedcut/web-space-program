import { useState } from 'react';
import type { FlightData } from '../../game/flightData';

export function FlightDataPanel({ data, onClose }: { data: FlightData; onClose(): void }) {
  const [sections, setSections] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('wsp.flightDataSections') ?? 'null');
      return Array.isArray(saved) ? saved.filter((s): s is string => typeof s === 'string') : data.map(s => s.title);
    }
    catch { return data.map(s => s.title); }
  });
  const [configure, setConfigure] = useState(false);
  return <div className="panel flight-data">
    <div className="flight-data-title"><span className="label">Flight data</span>
      <button className="btn small" onClick={() => setConfigure(!configure)} aria-label="Configure flight data">⚙</button>
      <button className="btn small" onClick={onClose} aria-label="Close flight data">×</button></div>
    {configure && <div className="flight-data-config">{data.map(s => <label key={s.title}>
      <input type="checkbox" checked={sections.includes(s.title)} onChange={e => {
        const next = e.target.checked ? [...sections, s.title] : sections.filter(x => x !== s.title);
        setSections(next);
        try { localStorage.setItem('wsp.flightDataSections', JSON.stringify(next)); } catch { /* storage unavailable */ }
      }} /> {s.title}</label>)}</div>}
    {data.filter(s => sections.includes(s.title)).map(s => <details key={s.title} open>
      <summary className="label">{s.title}</summary>
      {s.rows.map(([label, value]) => <div className="flight-data-row" key={label}><span>{label}</span><span className="mono">{value}</span></div>)}
    </details>)}
    <div className="flight-data-note">Impact: unpowered, no drag, current SOI. Burn: constant thrust and vertical descent. Orbit angles use the inertial reference plane.</div>
  </div>;
}
