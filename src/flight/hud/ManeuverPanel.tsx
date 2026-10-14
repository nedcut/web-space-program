import { usePlanner } from './usePlanner';
import { DepartureOptions } from './DepartureOptions';
import type { TransferWindow as DepartureWindow } from '../../game/planning/windows';
import type { TransferPlan } from '../../game/planning/transfers';
import { applyEntryTrim, applyPlanningResult } from '../../game/planning/apply';
import { enteringDragPerMass, findEntry, type EntryTrimPlan } from '../../game/planning/entry';
import { TransferWindow } from './TransferWindow';
import { memo, useEffect, useRef, useState } from 'react';
import type { World } from '../../game/world';
import { timeToApoapsis, timeToPeriapsis } from '../../sim/orbit';
import { length } from '../../util/vec3';
import { formatCountdown, formatDistance, formatDuration } from '../../ui/format';
import { planCircularization } from '../../game/autopilot';
import { useRenderProfile } from './useRenderProfile';
import { getTutorial } from '../../tutorial/runtime';
import type { FlightMap } from '../map/FlightMap';
import { burnTime, vacuumStages } from '../map/nodeInfo';
import { AXIS_COLORS } from '../../render/map/mapIcons';
import { SasIcon } from './glyphs';
import { CorridorGauge, DvBudget, Timeline } from './PlannerBits';
import { budgetStages, dvText, shortCountdown, shortDuration, whenTitle } from './plannerFormat';
import './planner.css';

const OPEN_KEY = 'wsp.mapPlanner.open.v1';
/** '1' opened, '0' collapsed by the player, null never toggled. */
function storedOpen(): string | null {
  try { return localStorage.getItem(OPEN_KEY); } catch { return null; }
}

/** The last transfer the planner installed, shown as a timeline card while its node exists. */
interface PlanCard { target: string; nodeId: number; encounterTime: number; periapsis: number; captureDv?: number; returnPerigee?: number }
/** The last entry trim the planner installed, shown with its corridor gauge while its node exists. */
interface TrimCard { nodeId: number; plan: EntryTrimPlan }

const WarpGlyph = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M2 3l6 5-6 5zM8 3l6 5-6 5z" /></svg>;
const FrameGlyph = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>;
const ChartGlyph = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M2 2h3v3H2zM6 2h3v3H6zM10 6h3v3h-3zM2 10h3v3H2zM6 6h3v3H6zM10 10h3v3h-3z" opacity=".85" /></svg>;

/**
 * Collapsible "Maneuver planner" app shown in map view. Nodes are normally placed by clicking the orbit and shaped
 * with the map gizmo; this panel holds the planning tools (circularize, transfers, transfer windows) and a node list.
 * Readouts are chips and bars (Δv budget, plan timeline); full figures sit in tooltips.
 * Memoised: it refreshes on its own 4 Hz clock rather than with every HUD telemetry publication.
 */
export const ManeuverPanel = memo(function ManeuverPanel({ world, map }: { world: World; map?: FlightMap }) {
  useRenderProfile();
  const [, force] = useState(0);
  // Open when the player left it open, in a lesson, or when there is a plan to show (unless they collapsed it).
  const [open, setOpen] = useState(() => { const s = storedOpen(); return s === '1' || !!getTutorial() || (s !== '0' && world.nodes.length > 0); });
  const planner = usePlanner(world);
  const [planMsg, setPlanMsg] = useState('');
  const [card, setCard] = useState<PlanCard | null>(null);
  const [trim, setTrim] = useState<TrimCard | null>(null);
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [options, setOptions] = useState<{ target: string; windows: DepartureWindow[] } | null>(null);

  // Node list readouts (and the collapsed header's node count) refresh at 4 Hz. A new plan (no nodes → some) opens
  // the planner so its node list and tools are in view; a later collapse holds until the next new plan.
  const hadNodes = useRef(world.nodes.length > 0);
  useEffect(() => {
    const id = window.setInterval(() => {
      const has = world.nodes.length > 0;
      if (has && !hadNodes.current) setOpen(true);
      hadNodes.current = has;
      force((x) => (x + 1) % 1e6);
    }, 250);
    return () => window.clearInterval(id);
  }, [world]);

  const toggle = () => {
    setOpen(o => {
      try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* session only */ }
      return !o;
    });
  };

  const wv = world.active;
  if (!wv || wv.mode === 'prelaunch') return null;

  const header = <button className="btn small mp-head" data-tutorial="maneuver" aria-expanded={open} onClick={toggle}
    title="Circularize, transfer planning, transfer windows and node list">
    Maneuver planner <span aria-hidden>{open ? '▾' : '▸'}</span>
    {world.nodes.length > 0 && <span className="pl-chip" aria-label={`${world.nodes.length} node${world.nodes.length > 1 ? 's' : ''}`}>{world.nodes.length}</span>}
  </button>;
  if (!open) return header;

  const orbit = world.orbitOf(wv);
  const body = world.universe.body(wv.body);

  const add = (when: 'ap' | 'pe' | 'soon') => {
    const t = when === 'ap' ? timeToApoapsis(orbit, world.ut) : when === 'pe' ? timeToPeriapsis(orbit, world.ut) : 120;
    const n = world.addNode(world.ut + (isFinite(t) && t > 5 ? t : 120));
    world.nodes = [...world.nodes].sort((a, b) => a.time - b.time);
    map?.selectNode(n.id);
  };

  const sun = world.universe.sunId;
  const siblings = body.parent === sun ? world.universe.body(sun).children.filter(id => id !== body.id).map(id => world.universe.body(id)) : [];
  const targets = [...siblings, ...body.children.map((id) => world.universe.body(id)), ...(body.parent && body.parent !== sun ? [world.universe.body(body.parent)] : [])]
    .filter((b) => b.kind !== 'star')
    .sort((a, b) => (a.orbit?.a ?? 0) - (b.orbit?.a ?? 0));
  const charts = (id: string) => siblings.some(b => b.id === id);

  const installed = (target: string, plan: TransferPlan, captureDv?: number) => {
    const node = world.nodes[0];
    if (node) setCard({ target, nodeId: node.id, encounterTime: plan.encounterTime, periapsis: plan.periapsisAltitude, captureDv, returnPerigee: plan.returnPerigee });
    setPlanMsg('');
  };
  const planTransfer = async (id: string, departure?: number, captureDv?: number, freeReturn = false) => {
    setPlanMsg('');
    try {
      const options = { ...(departure !== undefined ? { departure } : {}), ...(freeReturn ? { freeReturn } : {}) };
      const { result: plan, snapshot } = await planner.run('transfer', { target: id, ...(Object.keys(options).length ? { options } : {}) });
      if (!plan) { setPlanMsg(freeReturn ? 'No free return found from this orbit. Plan a normal transfer instead.' : departure !== undefined ? 'That departure did not refine to an encounter. Try another option.' : 'No transfer window found'); return; }
      applyPlanningResult(world, snapshot, plan);
      const node = world.nodes[0];
      if (map && node) { map.selectNode(node.id); map.frameTransfer(id); }
      // Keep the option list from the first search when the player picks one of its departures.
      if (departure === undefined && plan.windows?.length) setOptions({ target: id, windows: plan.windows });
      installed(id, plan, captureDv);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setPlanMsg((e as Error).message);
    }
  };
  const listDepartures = async (id: string) => {
    setPlanMsg(''); setOptions(null);
    try {
      const { result } = await planner.run('windows', { target: id });
      setOptions({ target: id, windows: result });
      if (!result.length) setPlanMsg('No departure windows found from this orbit.');
    } catch (e) { if ((e as Error).name !== 'AbortError') setPlanMsg((e as Error).message); }
  };
  const planCirc = (at: 'apoapsis' | 'periapsis') => {
    world.nodes = [];
    try {
      planCircularization(world, at);
      setPlanMsg('');
    } catch (e) {
      setPlanMsg((e as Error).message);
    }
  };
  const planEntryTrim = async () => {
    setPlanMsg('');
    try {
      const { result: plan, snapshot } = await planner.run('entry', { dragPerMass: enteringDragPerMass(wv.state) });
      if (!plan) { setPlanMsg('No trim found: the return is outside what a small correction can fix.'); return; }
      applyEntryTrim(world, snapshot, plan);
      const node = world.nodes.find(n => Math.abs(n.time - plan.node.time) < 1e-6 && n.prograde === plan.node.prograde);
      if (node) { setTrim({ nodeId: node.id, plan }); map?.selectNode(node.id); }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setPlanMsg((e as Error).message);
    }
  };
  // The trajectory comes down into air (after any planned nodes): offer the trim while still above the atmosphere.
  const atmoTop = body.atmosphere ? body.radius + body.atmosphere.height : 0;
  const entry = (!atmoTop || length(world.relativeState(wv).position) > atmoTop) ? findEntry(world.trajectory(), id => world.universe.body(id)) : null;
  const nodes = [...world.nodes].sort((a, b) => a.time - b.time);
  // A probe out of contact flies only the nodes it received while it had signal.
  const offline = !world.canControl(wv.state);
  const nodeDv = (n: { prograde: number; normal: number; radial: number }) => Math.hypot(n.prograde, n.normal, n.radial);
  const planNode = card ? nodes.find(n => n.id === card.nodeId) : undefined;
  const stages = nodes.length ? vacuumStages(world) : [];
  const need = nodes.reduce((s, n) => s + nodeDv(n), 0);

  let cardView = null;
  if (card && planNode) {
    const target = world.universe.body(card.target).name, dv = nodeDv(planNode), burn = burnTime(world, dv, stages);
    const startIn = planNode.time - world.ut - (Number.isFinite(burn) ? burn / 2 : 0);
    cardView = <div className="mp-card" aria-label={`${target} transfer`}>
      <div className="mp-card-head">
        <span className="mp-card-title">{target} transfer</span>
        <span className="pl-num">{dvText(dv)}</span>
        {map && <button className="btn ghost small pl-icon" title="Show whole transfer" aria-label="Show whole transfer" onClick={() => map.frameTransferOverview(card.target)}><FrameGlyph /></button>}
      </div>
      <Timeline
        stops={[
          { label: 'Now' },
          { label: 'Burn', value: Number.isFinite(burn) ? shortDuration(burn) : 'no engine', tone: 'burn', title: `Node ${whenTitle(planNode.time, world.ut)}\nBurn ${Number.isFinite(burn) ? formatDuration(burn) : '— (no active engine)'}, start ${formatCountdown(startIn)}` },
          { label: target, value: `Pe ${formatDistance(card.periapsis)}`, tone: 'arrive', title: `Encounter ${whenTitle(card.encounterTime, world.ut)}\nPeriapsis ${formatDistance(card.periapsis)}${card.captureDv ? `\nCapture ~${dvText(card.captureDv)} (estimate)` : ''}` },
          ...(card.returnPerigee !== undefined ? [{ label: world.universe.body(world.universe.body(card.target).parent!).name, value: `Pe ${formatDistance(card.returnPerigee)}`, tone: 'arrive' as const,
            title: `Free return: the flyby bends the path home with no return burn.\nEntry periapsis ${formatDistance(card.returnPerigee)}. Fix small errors with a correction burn on the way.` }] : []),
        ]}
        gaps={[shortDuration(startIn), shortDuration(card.encounterTime - planNode.time), ...(card.returnPerigee !== undefined ? ['flyby'] : [])]} />
      {map && <button className="btn small primary" disabled={!!planner.progress} title="Warp to the burn. Flight assist → Execute next node can fly it." onClick={() => map.warpToNode(planNode.id)}>Warp to burn</button>}
    </div>;
  }

  const trimNode = trim ? nodes.find(n => n.id === trim.nodeId) : undefined;
  let trimView = null;
  if (trim && trimNode) {
    const p = trim.plan, where = world.universe.body(p.body).name, dv = nodeDv(trimNode), burn = burnTime(world, dv, stages);
    trimView = <div className="mp-card" aria-label={`${where} entry trim`}>
      <div className="mp-card-head">
        <span className="mp-card-title">Entry trim · {where}</span>
        <span className="pl-num">{dv < 10 ? `${dv.toFixed(2)} m/s` : dvText(dv)}</span>
        <span />
      </div>
      <CorridorGauge steep={p.corridor.steep} shallow={p.corridor.shallow} current={p.before} planned={p.after} gLimit={p.corridor.gLimit} />
      <Timeline stops={[
        { label: 'Now' },
        { label: 'Trim', value: Number.isFinite(burn) ? shortDuration(burn) : 'no engine', tone: 'burn', title: `Node ${whenTitle(trimNode.time, world.ut)}` },
        { label: 'Entry', value: `Pe ${formatDistance(p.after)}`, tone: 'arrive', title: `Periapsis ${whenTitle(p.entryTime, world.ut)}: ${formatDistance(p.after)} (was ${formatDistance(p.before)})` },
      ]} gaps={[shortDuration(trimNode.time - world.ut), shortDuration(p.entryTime - trimNode.time)]} />
      {map && <button className="btn small primary" disabled={!!planner.progress} title="Warp to the burn. Flight assist → Execute next node can fly it." onClick={() => map.warpToNode(trimNode.id)}>Warp to burn</button>}
    </div>;
  }

  const chartButton = options && charts(options.target) ? <button className="btn ghost small pl-icon" disabled={!!planner.progress} title="Transfer window chart (departure date × flight time)" aria-label="Transfer window chart" onClick={() => setTransferTarget(options.target)}><ChartGlyph /></button> : null;
  const moon = options && world.universe.body(options.target).parent === body.id;
  const freeReturnButton = moon ? <button className="btn small" disabled={!!planner.progress} title="Plan a flyby that swings back home without a return burn (crewed first flights)" onClick={() => planTransfer(options.target, undefined, undefined, true)}>Free return</button> : null;
  const frameButton = options && map ? <button className="btn ghost small pl-icon" title="Show whole transfer" aria-label="Show whole transfer" onClick={() => map.frameTransferOverview(options.target)}><FrameGlyph /></button> : null;

  return (
    <>
    {transferTarget && <TransferWindow world={world} target={transferTarget} onClose={() => setTransferTarget(null)} onPlanned={(plan, captureDv) => installed(transferTarget, plan, captureDv)} />}
    {/* Header and node list stay in view; the tools scroll so the panel never reaches the staging stack or navball. */}
    <div className="panel mp">
      {header}
      {nodes.length > 0 && <div className="mp-nodes">
        {nodes.map((n, i) => { const unsent = offline && !world.uploadedNode(n.id); return <div key={n.id} className={`mp-node${unsent ? ' unsent' : ''}`}>
          <button className="btn ghost small mp-node-main" onClick={() => map?.openNode(n.id)} title={`Node ${i + 1}: ${nodeDv(n).toFixed(1)} m/s at ${whenTitle(n.time, world.ut)}${unsent ? '\nNot sent: no signal. The probe gets this node at its next station pass; until then it cannot fly it.' : offline ? '\nSent to the probe: its flight computer can fly this node without signal.' : ''}\nClick to edit`}>
            <span className="mp-idx">{i + 1}</span>
            <span className="pl-num">{nodeDv(n).toFixed(1)}<span className="unit">m/s</span></span>
            <span className="pl-num dim">{shortCountdown(n.time - world.ut)}</span>
          </button>
          {map && <button className="btn small pl-icon" aria-label={`Warp to node ${i + 1}`} title="Warp to node" onClick={() => map.warpToNode(n.id)}><WarpGlyph /></button>}
          <button className="btn small danger pl-icon" aria-label={`Delete node ${i + 1}`} title="Delete node" onClick={() => map ? map.deleteNode(n.id) : world.removeNode(n.id)}>×</button>
        </div>; })}
      </div>}
      {nodes.length > 0 && <DvBudget stages={budgetStages(stages)} need={need} extra={planNode ? card?.captureDv : undefined} />}
      {cardView}
      {trimView}
      <div className="mp-scroll">
        {world.preciseGravity && <div className="mp-note" title="The map shows the precise (n-body) path; planners use patched conics. Allow correction burns.">Precise path · plans use patched conics</div>}
        {nodes.length === 0 && <div className="mp-hint" title="Drag a node's handles to shape it; click the node for exact values. Arrow keys nudge the selected node (? in the map readout lists all keys).">
          <span>Click your orbit to add a node</span>
          <span className="mp-axes">
            <span style={{ color: AXIS_COLORS.prograde }}><SasIcon mode="prograde" size={14} /> prograde</span>
            <span style={{ color: AXIS_COLORS.normal }}><SasIcon mode="normal" size={14} /> normal</span>
            <span style={{ color: AXIS_COLORS.radial }}><SasIcon mode="radialOut" size={14} /> radial</span>
          </span>
        </div>}
        <div className="mp-row">
          <span className="mp-row-label">Add node</span>
          <button className="btn small" aria-label="Node @ Ap" title="Add a node at apoapsis" onClick={() => add('ap')} disabled={orbit.e >= 1}>Ap</button>
          <button className="btn small" aria-label="Node @ Pe" title="Add a node at periapsis" onClick={() => add('pe')}>Pe</button>
          <button className="btn small" aria-label="Node in 2 minutes" title="Add a node 2 minutes from now" onClick={() => add('soon')}>+2m</button>
        </div>
        <div className="mp-row">
          <span className="mp-row-label">Circularize</span>
          <button className="btn small" aria-label="Circularize @ Ap" title="Replace nodes with a circularization burn at apoapsis" onClick={() => planCirc('apoapsis')} disabled={orbit.e >= 1}>Ap</button>
          <button className="btn small" aria-label="Circularize @ Pe" title="Replace nodes with a circularization burn at periapsis" onClick={() => planCirc('periapsis')}>Pe</button>
        </div>
        {entry && <div className="mp-row">
          <span className="mp-row-label">Entry</span>
          <button className="btn small" disabled={!!planner.progress} aria-label="Entry trim"
            title={`Plan the smallest burn that puts the ${world.universe.body(entry.body).name} periapsis (now ${formatDistance(entry.periapsis)}) in this craft's entry corridor: deep enough not to skip out, shallow enough for heat and g.`}
            onClick={planEntryTrim}>Entry trim</button>
        </div>}
        {targets.length > 0 && <div className="mp-row">
          <span className="mp-row-label">Transfer</span>
          <select
            className="btn small"
            aria-label="Transfer destination"
            title="List departures to a destination"
            disabled={!!planner.progress || !!transferTarget}
            value=""
            onChange={(e) => e.target.value && listDepartures(e.target.value)}
          >
            <option value="">{options ? world.universe.body(options.target).name : 'Destination…'}</option>
            {targets.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>}
        {planner.progress && <div role="status" className="mp-prog" title={planner.progress.phase}>
          <span className="mp-prog-phase">{planner.progress.phase}</span>
          <span className="pl-num">{Math.round(planner.progress.fraction * 100)}%</span>
          <button className="btn ghost small pl-icon" aria-label="Cancel planning" title="Cancel planning" onClick={() => { planner.cancel(); setPlanMsg('Planning cancelled'); }}>×</button>
          <progress aria-label="Transfer planning progress" value={planner.progress.fraction} max={1} />
        </div>}
        {planMsg && <div className="mp-msg">{planMsg}</div>}
        {options && <DepartureOptions world={world} options={options} busy={!!planner.progress} tools={<>{freeReturnButton}{chartButton}{frameButton}</>}
          onPick={w => planTransfer(options.target, w.departure, w.captureDv)} />}
      </div>
    </div>
    </>
  );
});
