import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PART_DEFS } from '../../data/parts';
import type { PartCategory, PartDef } from '../../sim/vessel/types';
import type { EditorSession, SessionView } from '../session';
import { getThumbnail, requestThumbnails, subscribeThumbnails, thumbnailVersion } from '../scene/thumbnails';
import { Icon } from './icons';
import { CATEGORY_TABS, RESOURCE_SHORT, fmtKN, fmtKg, sizeLabel, wetMass } from './partInfo';

export function useThumbnails() {
  return useSyncExternalStore(subscribeThumbnails, thumbnailVersion);
}

export function Palette({ session, view }: { session: EditorSession; view: SessionView }) {
  const [tab, setTab] = useState<PartCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<{ def: PartDef; y: number } | null>(null);
  useThumbnails();
  const heldAtDown = useRef(false);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of PART_DEFS) c.set(d.category, (c.get(d.category) ?? 0) + 1);
    return c;
  }, []);

  const parts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PART_DEFS.filter((d) => (tab === 'all' || d.category === tab) && (!q || `${d.name} ${d.manufacturer} ${d.description} ${d.category}`.toLowerCase().includes(q)));
  }, [tab, query]);

  useEffect(() => {
    // Visible parts first, then the rest of the catalogue in the background.
    requestThumbnails(parts);
    requestThumbnails(PART_DEFS);
  }, [parts]);

  const holding = !!view.held;

  return (
    <div
      className={`vab-palette panel ${holding ? 'discard' : ''}`}
      onPointerDownCapture={() => (heldAtDown.current = !!session.getSnapshot().held)}
      onPointerUp={() => {
        if (heldAtDown.current) session.deleteHeld();
      }}
    >
      <div className="vab-tabs">
        {CATEGORY_TABS.filter((t) => t.id === 'all' || counts.get(t.id)).map((t) => (
          <button key={t.id} className={`vab-tab ${tab === t.id ? 'on' : ''}`} title={t.label} onClick={() => setTab(t.id)}>
            <Icon name={t.id} size={19} />
          </button>
        ))}
      </div>
      <div className="vab-palette-main">
        <div className="vab-palette-head">
          <div className="label">{CATEGORY_TABS.find((t) => t.id === tab)?.label}</div>
          <div className="vab-search">
            <Icon name="search" size={15} />
            <input value={query} placeholder="Search parts" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
          </div>
        </div>
        <div className="vab-cards">
          {parts.map((d) => {
            const src = getThumbnail(d.id);
            return (
              <button
                key={d.id}
                className={`vab-card ${view.held?.kind === 'new' && view.held.partId === d.id ? 'on' : ''}`}
                onMouseEnter={(e) => setHover({ def: d, y: (e.currentTarget as HTMLElement).getBoundingClientRect().top })}
                onMouseLeave={() => setHover((h) => (h?.def === d ? null : h))}
                onClick={() => {
                  if (heldAtDown.current) return;
                  session.pickNew(d.id);
                }}
              >
                <div className="vab-thumb">{src ? <img src={src} alt="" draggable={false} /> : <div className="vab-thumb-wait" />}</div>
                <div className="vab-card-name">{d.name}</div>
              </button>
            );
          })}
          {!parts.length && <div className="vab-empty">No parts match “{query}”.</div>}
        </div>
      </div>
      {holding && (
        <div className="vab-discard">
          <Icon name="trash" size={28} />
          <div>Drop here to discard</div>
        </div>
      )}
      {hover && !holding && <PartTooltip def={hover.def} y={hover.y} />}
    </div>
  );
}

function PartTooltip({ def, y }: { def: PartDef; y: number }) {
  const engine = def.modules.find((m) => m.type === 'engine');
  const cmd = def.modules.find((m) => m.type === 'command');
  const dec = def.modules.find((m) => m.type === 'decoupler');
  const chute = def.modules.find((m) => m.type === 'parachute');
  const wing = def.modules.find((m) => m.type === 'liftingSurface');
  const wheel = def.modules.find((m) => m.type === 'reactionWheel');
  const solar = def.modules.find((m) => m.type === 'solarPanel');
  const rows: [string, string][] = [];
  const wet = wetMass(def);
  rows.push(['Mass', wet > def.dryMass + 0.5 ? `${fmtKg(wet)} (dry ${fmtKg(def.dryMass)})` : fmtKg(def.dryMass)]);
  rows.push(['Cost', `${def.cost.toLocaleString('en-US')} cr`]);
  rows.push(['Size', sizeLabel(def)]);
  if (engine && engine.type === 'engine') {
    rows.push(['Thrust', `${fmtKN(engine.maxThrustVac)} vac · ${fmtKN((engine.maxThrustVac * engine.ispAsl) / engine.ispVac)} ASL`]);
    rows.push(['Isp', `${engine.ispVac} s vac · ${engine.ispAsl} s ASL`]);
    rows.push(['Twr (part)', ((engine.maxThrustVac / (wet * 9.81))).toFixed(1)]);
    if (engine.gimbalRange) rows.push(['Gimbal', `±${((engine.gimbalRange * 180) / Math.PI).toFixed(1)}°`]);
    rows.push(['Throttle', engine.throttleable ? `${Math.round(engine.minThrottle * 100)}–100%` : 'Fixed (solid)']);
  }
  if (cmd && cmd.type === 'command') rows.push(['Crew', cmd.crew ? `${cmd.crew} seat${cmd.crew > 1 ? 's' : ''}` : 'Uncrewed probe']);
  if (wheel && wheel.type === 'reactionWheel') rows.push(['Torque', `${(wheel.torque / 1000).toFixed(1)} kN·m`]);
  if (dec && dec.type === 'decoupler') rows.push(['Ejection', `${dec.ejectionImpulse} N·s${dec.radial ? ' (radial)' : ''}`]);
  if (chute && chute.type === 'parachute') rows.push(['Drag area', `${chute.deployedCdA} m²`]);
  if (wing && wing.type === 'liftingSurface') rows.push(['Wing area', `${wing.area} m²${wing.deflection ? ' · control' : ''}`]);
  if (solar && solar.type === 'solarPanel') rows.push(['Charge', `${solar.chargeRate} EC/s`]);
  for (const [k, v] of Object.entries(def.resources)) if (v) rows.push([RESOURCE_SHORT[k as keyof typeof RESOURCE_SHORT], `${Math.round(v).toLocaleString('en-US')} u`]);
  rows.push(['Attach', [def.attachNodes.some((n) => n.id !== 'srf') ? 'stack' : '', def.surfaceAttachable ? 'surface' : ''].filter(Boolean).join(' + ') || '—']);
  const top = Math.max(64, Math.min(y - 20, window.innerHeight - 380));
  return (
    <div className="vab-tooltip panel" style={{ top }}>
      <div className="vab-tt-name">{def.name}</div>
      <div className="vab-tt-mfr">{def.manufacturer}</div>
      <div className="vab-tt-desc">{def.description}</div>
      <table className="vab-tt-table mono">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
