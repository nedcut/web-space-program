import { useEffect, useMemo, useRef, useState } from 'react';
import { BODY_DEFS } from '../data/bodies';
import { PART_CATALOG } from '../data/parts';
import { BODY_ARTICLES, PART_ARTICLES, FLIGHT_SCHOOL, PEDIA_INDEX, atmosphereProfile } from '../data/pedia';
import { buildUniverse, SCALE_PRESETS } from '../sim/bodies/scale';
import type { Body } from '../sim/bodies/types';
import { game, useGame, type Scene } from '../game/store';
import { mountPlanetPreview } from './planetPreview';
import { mountPartTurntable } from '../editor/scene/thumbnails';
import './pedia.css';
import { LANDMARKS } from '../sim/terrain/landmarks';

const NO_DISCOVERIES: readonly string[] = [];
let returnScene: Scene = 'menu';
export function openPedia(from: Scene) { returnScene = from; game.set({ scene: 'pedia' }); }

function Preview({ id, part = false }: { id: string; part?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preset = useGame(s => s.scalePreset);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    try {
      return part ? mountPartTurntable(canvas.current!, PART_CATALOG.get(id)!, () => game.get().settings.reduceMotion)
        : mountPlanetPreview(canvas.current!, id, preset, false, ok => setFailed(!ok));
    } catch { setFailed(true); }
  }, [id, part, preset]);
  return <div className="pedia-preview"><canvas ref={canvas} aria-label={`${id} rotating 3D preview`} />{failed && <p>3D preview unavailable on this device.</p>}<span className="label">{part ? 'Hardware turntable' : 'Procedural globe · not photographic'}</span></div>;
}
const fieldLabel = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
const number = (n: number, unit: string) => `${Number.isFinite(n) ? n.toLocaleString(undefined, { maximumSignificantDigits: 6 }) : '∞'} ${unit}`;

function AtmosphereChart({ body, real }: { body: Body; real: Body }) {
  const scaled = atmosphereProfile(body), source = atmosphereProfile(real);
  if (!scaled.length) return <p>No modeled atmosphere. Flight above the surface uses vacuum conditions.</p>;
  const pmax = body.atmosphere!.surfacePressure;
  const tmax = Math.max(...source.map(p => p.temperature));
  const path = (samples: typeof scaled, field: 'pressure' | 'temperature', max: number) => samples.map((p, i) => `${i ? 'L' : 'M'}${45 + (p[field] / max) * 300},${185 - p.altitude / Math.max(body.atmosphere!.height, real.atmosphere!.height) * 150}`).join(' ');
  return <><h3>Atmosphere profile</h3><p className="pedia-muted">Altitude vs pressure (gold, 0–{number(pmax, 'Pa')}) and temperature (blue, 0–{number(tmax, 'K')}). Dashed curves: real scale. The game tapers both at its vacuum cutoff.</p>
    <svg viewBox="0 0 420 230" role="img" aria-label="Pressure and temperature versus altitude"><path d="M45 25V185H355" fill="none" stroke="#607085" />
      {([scaled, source]).map((samples, i) => <g key={i} strokeDasharray={i ? '4 4' : undefined}><path d={path(samples, 'pressure', pmax)} fill="none" stroke="#e9c989" /><path d={path(samples, 'temperature', tmax)} fill="none" stroke="#79cfff" /></g>)}
      <text x="5" y="20">{number(Math.max(body.atmosphere!.height, real.atmosphere!.height) / 1000, 'km')}</text><text x="15" y="185">0</text><text x="90" y="215">Pressure / temperature →</text>
    </svg></>;
}
function Diagram({ kind = 'orbit', e = 0.45 }: { kind?: string; e?: number }) {
  const eccentricity = Math.min(0.95, Math.max(0, e));
  const b = 85 * Math.sqrt(1 - eccentricity ** 2);
  if (kind === 'transfer') return <svg className="pedia-diagram" viewBox="0 0 340 220" role="img" aria-label="Hohmann transfer between concentric circular orbits"><circle cx="140" cy="105" r="90" fill="none" stroke="#687b95" /><circle cx="140" cy="105" r="35" fill="none" stroke="#687b95" /><ellipse cx="167.5" cy="105" rx="62.5" ry={Math.sqrt(35 * 90)} fill="none" stroke="#79cfff" /><circle cx="140" cy="105" r="8" fill="#e9c989" /><circle cx="105" cy="105" r="4" fill="white" /><circle cx="230" cy="105" r="4" fill="white" /><text x="60" y="95">Burn 1</text><text x="235" y="95">Burn 2</text><text x="40" y="212">Transfer ellipse touches both circular orbits</text></svg>;
  return <svg className="pedia-diagram" viewBox="0 0 340 210" role="img" aria-label={`${kind} schematic`}>
    <ellipse cx="170" cy="100" rx="85" ry={b} fill="none" stroke="#79cfff" />
    <circle cx={170 - 85 * eccentricity} cy="100" r="10" fill="#e9c989" />
    <circle cx="255" cy="100" r="4" fill="white" />
    <path d={kind === 'turn' ? 'M70 180 Q80 50 260 40' : 'M255 100v-45l-5 9m5-9 5 9'} stroke="#e9c989" fill="none" />
    <text x="25" y="200">{kind === 'burn' ? 'Tangential thrust changes orbital energy' : kind === 'turn' ? 'Gradually build sideways velocity' : 'Focus • closest approach ← → farthest approach'}</text>
  </svg>;
}
export default function Spacepedia() {
  const discoveries = useGame(s => s.resumeWorld?.discoveries) ?? NO_DISCOVERIES;
  const preset = useGame(s => s.scalePreset);
  const bodies = useMemo(() => buildUniverse(BODY_DEFS, SCALE_PRESETS[preset]), [preset]);
  const realBodies = useMemo(() => buildUniverse(BODY_DEFS, SCALE_PRESETS.real), []);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'body' | 'part' | 'lesson'>('body');
  const [selected, setSelected] = useState('saturn');
  const entries = PEDIA_INDEX.filter(a => a.kind === tab && `${a.name} ${a.text} ${a.id}`.toLowerCase().includes(query.toLowerCase()));
  const article = entries.find(a => a.id === selected) ?? entries[0];
  const body = article?.kind === 'body' ? bodies.get(article.id)! : null;
  const real = body ? realBodies.get(body.id)! : null;
  const part = article?.kind === 'part' ? PART_CATALOG.get(article.id)! : null;
  const rows: [string, number | undefined, number | undefined, string][] = body && real ? [
    ['Mean radius', body.radius / 1000, real.radius / 1000, 'km'], ['GM', body.gm, real.gm, 'm³/s²'],
    ['Datum gravity', body.surfaceGravity, real.surfaceGravity, 'm/s²'], ['Escape speed', Math.sqrt(2 * body.gm / body.radius), Math.sqrt(2 * real.gm / real.radius), 'm/s'],
    ['Sidereal spin', body.rotationPeriod / 3600, real.rotationPeriod / 3600, 'h'], ['Orbital period', (body.orbitalPeriod ?? 0) / 86400, (real.orbitalPeriod ?? 0) / 86400, 'days'],
    ['Semi-major axis', body.orbit?.a, real.orbit?.a, 'm'], ['SOI', body.soi, real.soi, 'm'],
    ['Atmosphere cutoff', body.atmosphere?.height, real.atmosphere?.height, 'm'],
    ['Datum pressure', body.atmosphere?.surfacePressure, real.atmosphere?.surfacePressure, 'Pa'],
    ['Datum temperature', body.atmosphere?.surfaceTemperature, real.atmosphere?.surfaceTemperature, 'K'],
    ['Ring inner radius', body.rings?.innerRadius, real.rings?.innerRadius, 'm'], ['Ring outer radius', body.rings?.outerRadius, real.rings?.outerRadius, 'm'],
  ] : [];
  return <main className="fullscreen pedia"><header><div><div className="label">The explorer’s field guide</div><h1>Spacepedia</h1></div><div className="pedia-muted">Current universe: {preset}</div><button className="btn" onClick={() => game.set({ scene: returnScene })}>Back</button></header>
    <div className="pedia-layout"><aside className="panel"><nav>{(['body', 'part', 'lesson'] as const).map(t => <button className={`btn small ${tab === t ? 'primary' : ''}`} key={t} onClick={() => { setTab(t); setSelected(''); }}>{t === 'body' ? 'Worlds' : t === 'part' ? 'Parts' : 'Flight school'}</button>)}</nav>
      <input aria-label="Search Spacepedia" placeholder="Search names and descriptions…" value={query} onChange={e => setQuery(e.target.value)} /><div className="label">{entries.length} entries</div><div className="pedia-index">{entries.map(a => <button key={a.id} className={`btn ghost ${article?.id === a.id ? 'selected' : ''}`} onClick={() => setSelected(a.id)}>{a.name}</button>)}{!entries.length && <p>No matching entries.</p>}</div></aside>
      <article className="panel pedia-article">{article && <><div className="label">{article.kind === 'body' ? `${body!.kind} · ${body!.parent ?? 'solar system centre'}` : article.kind === 'part' ? part!.category : 'Flight school'}</div><h2>{article.name}</h2><p className="pedia-intro">{article.text}</p>
        {body && real && <><Preview key={body.id} id={body.id} /><table><thead><tr><th>Figure</th><th>{preset}</th><th>Real world</th></tr></thead><tbody>{rows.filter(r => r[1] !== undefined).map(([name, scaled, source, unit]) => <tr key={name}><th>{name}</th><td>{number(scaled!, unit)}</td><td>{number(source!, unit)}</td></tr>)}</tbody></table><p className="pedia-muted">Mean spherical radii; atmosphere cutoffs and procedural surfaces are model choices. Gas giant datum values do not describe solid ground. Figures use the catalog’s JPL / NASA source data.</p>
          <h3>Discovered landmarks</h3>{LANDMARKS.filter(l => l.body === body.id && discoveries.includes(l.id)).map(l => <section key={l.id}><h4>{l.name}</h4><p>{l.description}</p><p className="pedia-muted">{l.lat}° latitude · {l.lon}° longitude</p></section>)}{!LANDMARKS.some(l => l.body === body.id && discoveries.includes(l.id)) && <p>Approach a landmark within 2 km to record it here.</p>}
          <AtmosphereChart body={body} real={real} />{body.orbit && <><h3>Orbit about {bodies.get(body.parent!)?.name}</h3><Diagram e={body.orbit.e} /><p className="pedia-muted">Shape schematic in the orbital plane, not a distance scale. Eccentricity {body.orbit.e.toFixed(4)} · inclination {number(body.orbit.i * 180 / Math.PI, '°')} relative to {body.orbit.frame === 'parentEquator' ? 'the parent equator' : 'the ecliptic'}.</p></>}
          {body.parent === 'saturn' || body.id === 'saturn' ? <p className="pedia-muted">Science reading: <a href="https://science.nasa.gov/mission/cassini/science/rings/" target="_blank" rel="noreferrer">NASA Cassini rings</a> · <a href="https://science.nasa.gov/saturn/moons/titan/facts/" target="_blank" rel="noreferrer">Titan</a> · <a href="https://science.nasa.gov/saturn/moons/enceladus/" target="_blank" rel="noreferrer">Enceladus</a></p> : null}</>}
        {part && <><Preview key={part.id} id={part.id} part /><h3>Hardware specifications</h3><dl><dt>Manufacturer</dt><dd>{part.manufacturer}</dd><dt>Dry mass</dt><dd>{number(part.dryMass, 'kg')}</dd><dt>Cost</dt><dd>{number(part.cost, 'cr')}</dd><dt>Temperature limit</dt><dd>{number(part.maxTemp, 'K')}</dd><dt>Impact tolerance</dt><dd>{number(part.crashTolerance, 'm/s')}</dd><dt>Research</dt><dd>{PART_ARTICLES.find(p => p.id === part.id)!.research.name} · {PART_ARTICLES.find(p => p.id === part.id)!.research.cost} science</dd></dl><h3>Construction</h3><p>Attachment nodes: {part.attachNodes.map(n => n.id).join(', ') || 'none'} · Surface attachment: {part.surfaceAttachable ? 'yes' : 'no'}</p><p>Drag coefficient: axial {part.dragCoefficient.axial}, side {part.dragCoefficient.side}</p><p>{part.shape.kind === 'cylinder' ? `Height ${number(part.shape.height, 'm')} · end radii ${number(part.shape.radiusTop, 'm')} / ${number(part.shape.radiusBottom, 'm')}` : `Dimensions ${number(part.shape.size.x, 'm')} × ${number(part.shape.size.y, 'm')} × ${number(part.shape.size.z, 'm')}`}</p><h3>Resource capacity (catalog units)</h3>{Object.entries(part.resources).map(([k, v]) => <p key={k}>{k}: {v}</p>)}{!Object.keys(part.resources).length && <p>No storage.</p>}<h3>Modules</h3>{part.modules.map((m, i) => <section className="pedia-module" key={i}><strong>{m.type}</strong><dl>{Object.entries(m).filter(([k]) => k !== 'type').map(([k, v]) => <div key={k}><dt>{fieldLabel(k)}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>)}</dl></section>)}<p className="pedia-muted">Module fields use SI units unless marked by their name: thrust N, Isp s, mass kg, distance m, angle rad; storage and flow use catalog resource units. These are game hardware specifications.</p></>}
        {article.kind === 'lesson' && <Diagram kind={FLIGHT_SCHOOL.find(a => a.id === article.id)!.diagram} />}
      </>}</article></div><footer className="pedia-muted">{BODY_ARTICLES.length} worlds · {PART_ARTICLES.length} parts · {FLIGHT_SCHOOL.length} flight notes</footer></main>;
}
