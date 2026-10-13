import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button } from '../../ui/components';
import { Bar, Chips, InspectorLayer, OnOff, Section, TweakControls, type InspectorContent, type InspectorPanelProps } from '../../ui/inspector/Inspector';
import { RESOURCE_COLORS } from '../../ui/inspector/resources';
import { RESOURCES } from '../../data/resources';
import { ACTION_GROUP_IDS, ACTION_LABELS, GROUP_LABELS, actionAvailable, actionState, partActions } from '../../sim/vessel/actions';
import { isExtended, thrustLimit, tweakDescriptors } from '../../sim/vessel/tweaks';
import type { PartState, VesselState } from '../../sim/vessel/runtime';
import type { PartActionId, PartTweaks, ResourceId } from '../../sim/vessel/types';
import type { FlightController } from '../controller';
import { game } from '../../game/store';
import { canControlFrom, controlPartUid, freeSeats, stationModules } from '../../sim/vessel';
import { seatCapacity } from '../../sim/crew/crew';
import { berths } from './StationPanel';
import { useRenderProfile } from './useRenderProfile';

const fmtKN = (n: number) => (n < 1000 ? `${n.toFixed(0)} N` : `${(n / 1000).toFixed(n < 1e5 ? 1 : 0)} kN`);
/** The HUD's interactive boxes (same list as the pointer-events rule in hud.css): new windows avoid them when crowded. */
const HUD_BOXES = '.hud-left > *:not(.hud-left-fill):not(.hud-left-bottom), .hud-left-bottom > *, .hud-top > *:not(.hud-messages), .hud-right > .app-bar, .app-stack > *, .crew-dock > *, .hud-bottom > *, .hud > .app-win';
const hudBoxes = () => [...document.querySelectorAll(HUD_BOXES)].map(e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }).filter(r => r.w > 0 && r.h > 0);
const fmtAmount = (n: number) => n.toFixed(n < 10 ? 1 : 0);
const CHUTE_PHASE: Record<string, { text: string; tone?: 'good' | 'warn' }> = {
  stowed: { text: 'Chute stowed' }, armed: { text: 'Chute armed', tone: 'warn' }, semi: { text: 'Chute partly open', tone: 'good' }, full: { text: 'Chute open', tone: 'good' }, cut: { text: 'Chute cut', tone: 'warn' },
};

/**
 * Everything a part window shows, quantised as displayed. While it is unchanged the 6 Hz refresh skips the window's
 * body; the seconds counter re-renders it at least once a second for slower state (science availability, berths).
 */
function partSig(c: FlightController, v: VesselState, p: PartState, enabled: boolean): string {
  const e = p.engine;
  let s = `${enabled}|${Math.round(Math.max(p.temperature, ...p.skinTemperature))}|${Math.round((v.cache.jointLoads?.get(p.uid)?.fraction ?? -1) * 100)}`;
  if (e) s += `|${e.ignited}${e.flamedOut}${e.ignitionsLeft}|${fmtKN(e.thrust)}|${Math.round(e.isp)}`;
  s += `|${p.chute?.phase}|${p.panelDeploy?.toFixed(2)}|${p.panelTorn}|${actionState(p, 'deploy.toggle')}|${p.drillDeployed}|${p.converterRunning}|${p.activated}`;
  s += `|${p.docked?.vesselName}|${p.scienceData?.length}|${p.electronicsFailed}${p.electronicsDegraded}|${p.crew?.join()}|${controlPartUid(v)}|${c.world.transmitting.includes(v.id)}`;
  for (const k in p.resources) s += `|${fmtAmount(p.resources[k as ResourceId] ?? 0)}`;
  return `${s}|${JSON.stringify(p.tweaks)}|${JSON.stringify(p.actions)}|${Math.floor(performance.now() / 1000)}`;
}

/** Flight part inspectors: right-click / long-press a part of the active vessel. */
export function FlightInspector({ controller: c, panels, setPanels }: { controller: FlightController; panels: InspectorPanelProps[]; setPanels: (fn: (p: InspectorPanelProps[]) => InspectorPanelProps[]) => void }) {
  useRenderProfile();
  const [, refresh] = useState(0);
  useEffect(() => c.onPartPick(uid => setPanels(p => [...p.filter(x => x.pinned && x.uid !== uid), { uid, pinned: p.find(x => x.uid === uid)?.pinned ?? false }])), [c, setPanels]);
  // Live readouts at ~6 Hz (a window's body re-renders only when its readouts changed); panels of parts that left
  // the active vessel close themselves.
  const vesselId = useRef(c.world.activeId);
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = c.world.active?.state;
      if (c.world.activeId !== vesselId.current) { vesselId.current = c.world.activeId; setPanels(() => []); return; }
      setPanels(p => (p.some(x => !v?.cache.byUid.has(x.uid)) ? p.filter(x => v?.cache.byUid.has(x.uid)) : p));
      // Nothing to show in map view; the HUD's telemetry re-render restores the panels when it closes.
      if (!c.mapMode) refresh(n => n + 1);
    }, 160);
    return () => window.clearInterval(id);
  }, [c, setPanels]);
  const anchor = useCallback((uid: number) => c.partScreenPosition(uid), [c]);
  const anchorInto = useCallback((uid: number, out: { x: number; y: number }) => c.partScreenInto(uid, undefined, out), [c]);
  const content = (uid: number): InspectorContent | null => {
    const wv = c.world.active, v = wv?.state;
    const p = v?.cache.byUid.get(uid);
    if (!wv || !v || !p) return null;
    const copies = p.symmetryGroup === undefined ? 1 : v.parts.filter(q => q.symmetryGroup === p.symmetryGroup && q.partId === p.partId).length;
    const enabled = c.world.canControl(v) && !v.eva && (!c.network || c.network.ownId === v.id);
    return {
      title: p.def.name, partId: p.def.id, subtitle: `${p.def.name} · ${p.def.manufacturer}${copies > 1 ? ` · symmetry ×${copies}` : ''}`,
      badge: copies > 1 ? `×${copies}` : undefined, sig: `${copies}|${partSig(c, v, p, enabled)}`,
      body: <FlightPartBody c={c} part={p} copies={copies} enabled={enabled} />,
    };
  };
  if (c.mapMode) return null;
  return <InspectorLayer panels={panels} anchor={anchor} anchorInto={anchorInto} content={content} obstacles={hudBoxes} closeOnEscape
    onClose={uid => setPanels(p => p.filter(x => x.uid !== uid))}
    onPin={uid => setPanels(p => p.map(x => (x.uid === uid ? { ...x, pinned: !x.pinned } : x)))}
    insets={{ top: 110, right: 350, bottom: game.get().settings.navballSize + 70, left: 240 }} />;
}

function FlightPartBody({ c, part: p, copies, enabled }: { c: FlightController; part: PartState; copies: number; enabled: boolean }) {
  const wv = c.world.active!;
  const v = wv.state;
  const [draft, setDraft] = useState<PartTweaks>({});
  const send = useRef<{ at: number; timer: number; pending: PartTweaks }>({ at: 0, timer: 0, pending: {} });
  useEffect(() => () => window.clearTimeout(send.current.timer), []);
  const shown: PartTweaks = { ...p.tweaks, ...draft };
  // Drop draft keys once the authority reports the same value.
  useEffect(() => {
    const keys = Object.keys(draft) as (keyof PartTweaks)[];
    if (keys.length && keys.every(k => JSON.stringify(p.tweaks?.[k]) === JSON.stringify(draft[k]))) setDraft({});
  }, [draft, p.tweaks]);
  const change = (t: PartTweaks) => {
    setDraft(d => ({ ...d, ...t }));
    const s = send.current;
    s.pending = { ...s.pending, ...t };
    const flush = () => { c.setTweaks(p.uid, s.pending, true); s.pending = {}; s.at = performance.now(); s.timer = 0; };
    if (performance.now() - s.at > 150) flush();
    else if (!s.timer) s.timer = window.setTimeout(flush, 150);
  };

  const e = p.engine;
  const em = e ? p.def.modules[e.moduleIndex] : undefined;
  const skin = Math.max(p.temperature, ...p.skinTemperature);
  const heat = skin / p.maxTemp;
  const load = v.cache.jointLoads?.get(p.uid)?.fraction;
  const resources = (Object.entries(p.maxResources) as [ResourceId, number][]).filter(([id, max]) => id !== 'intakeAir' && max > 0);

  // State tags: only what is not already a gauge or a toggle.
  const chips: { text: string; tone?: 'good' | 'warn' | 'bad'; title?: string }[] = [];
  if (e && em?.type === 'engine') {
    chips.push({ text: `Isp ${e.isp.toFixed(0)} s`, title: 'Specific impulse now' });
    if (e.flamedOut) chips.push({ text: 'Flamed out', tone: 'bad', title: 'No propellant or intake air reaches this engine' });
    if (e.ignitionsLeft >= 0) chips.push({ text: `${e.ignitionsLeft} ignition${e.ignitionsLeft === 1 ? '' : 's'}`, tone: e.ignitionsLeft === 0 ? 'bad' : undefined, title: 'Ignitions left' });
  }
  if (p.chute) chips.push(CHUTE_PHASE[p.chute.phase] ?? { text: p.chute.phase });
  if (p.docked) chips.push({ text: `Docked · ${p.docked.vesselName}`, tone: 'good' });
  if (p.scienceData?.length) chips.push({ text: `${p.scienceData.length} result${p.scienceData.length === 1 ? '' : 's'} stored` });
  if (p.electronicsFailed) chips.push({ text: 'Electronics failed', tone: 'bad', title: 'Radiation damage' });
  else if (p.electronicsDegraded) chips.push({ text: 'Electronics degraded', tone: 'warn', title: 'Radiation damage' });

  // Two-state systems are on/off buttons; one-shot actions are buttons; actions that do not apply now are hidden.
  const toggles: { key: string; label: string; on: boolean; text: string; action: PartActionId; disabled?: boolean; bad?: boolean; title?: string }[] = [];
  const buttons: { action: PartActionId; label: string; experiment?: string; danger?: boolean; disabled?: boolean }[] = [];
  const actions = partActions(p.def);
  if (e && actions.includes('engine.activate')) {
    const action = e.ignited ? 'engine.shutdown' : 'engine.activate';
    const ok = actionAvailable(p, action);
    toggles.push({ key: 'engine', label: 'Engine', on: e.ignited, text: e.ignited ? 'Engine on' : 'Engine off', action, disabled: !ok, bad: e.flamedOut,
      title: ok ? (e.ignited ? 'Shut down' : 'Ignite') : e.ignited ? 'Solid motors burn out; they cannot be shut down' : 'No ignitions left' });
  }
  if (actions.includes('deploy.toggle')) {
    const out = !!actionState(p, 'deploy.toggle');
    const moving = p.panelDeploy !== undefined && p.panelDeploy > 0 && p.panelDeploy < 1;
    toggles.push({ key: 'deploy', label: 'Deploy', on: out && !p.panelTorn, action: 'deploy.toggle', disabled: !!p.panelTorn, bad: !!p.panelTorn,
      text: p.panelTorn ? 'Torn off' : moving ? (out ? 'Extending…' : 'Retracting…') : out ? 'Extended' : 'Retracted', title: p.panelTorn ? 'Torn off by air load or heat' : out ? 'Retract' : 'Extend' });
  }
  if (actions.includes('drill.toggle')) toggles.push({ key: 'drill', label: 'Drill', on: !!p.drillDeployed, text: p.drillDeployed ? 'Drill out' : 'Drill stowed', action: 'drill.toggle' });
  if (actions.includes('converter.toggle')) toggles.push({ key: 'conv', label: 'Converter', on: !!p.converterRunning, text: p.converterRunning ? 'Converter on' : 'Converter off', action: 'converter.toggle' });
  for (const a of actions) {
    if (!actionAvailable(p, a) && a !== 'science.transmit' && a !== 'science.run') continue;
    switch (a) {
      case 'decouple': buttons.push({ action: a, label: 'Decouple', danger: true }); break;
      case 'fairing.jettison': buttons.push({ action: a, label: 'Jettison', danger: true }); break;
      case 'chute.deploy': buttons.push({ action: a, label: 'Arm parachute' }); break;
      case 'chute.cut': buttons.push({ action: a, label: 'Cut parachute', danger: true }); break;
      case 'undock': buttons.push({ action: a, label: 'Undock', danger: true }); break;
      case 'science.transmit': {
        const data = v.parts.some(q => q.scienceData?.length);
        buttons.push({ action: a, label: c.world.transmitting.includes(v.id) ? 'Transmitting…' : 'Transmit data', disabled: !data || !isExtended(p) || c.world.transmitting.includes(v.id) });
        break;
      }
      case 'science.run':
        for (const i of c.world.scienceInstruments(wv).filter(i => i.uid === p.uid))
          buttons.push({ action: a, label: i.recorded ? `${i.name}: stored` : `Run ${i.name}`, experiment: i.experiment, disabled: !i.available || i.recorded });
        break;
    }
  }
  const descriptors = tweakDescriptors(p.def).filter(d => d.flight);
  // Crew and control: "control from here" on pods/probes/ports; seat moves to any free seat in the docked complex.
  const controllable = canControlFrom(p);
  const controlling = controlPartUid(v) === p.uid;
  const seats = seatCapacity(p);
  const dest = seats > 0 && p.crew?.length ? berths(stationModules(v)).filter(b => b.uid !== p.uid) : [];
  const crewName = (id: string) => c.world.crew.find(x => x.id === id)?.name ?? id;
  const groups = ACTION_GROUP_IDS.filter(g => p.actions?.[g]?.length);
  const noAuthority = 'No command authority';
  return <>
    <div className="insp-section">
      <Bar label="Temperature" value={skin} max={p.maxTemp} right={`${skin.toFixed(0)} K`} title={`Temperature ${skin.toFixed(0)} K of ${p.maxTemp.toFixed(0)} K`}
        color={heat > 0.9 ? 'var(--bad)' : heat > 0.7 ? 'var(--warn)' : '#ff9a5c'} tone={heat > 0.9 ? 'bad' : heat > 0.7 ? 'warn' : undefined} />
      {load !== undefined && <Bar label="Load" value={load} max={1} right={`${(load * 100).toFixed(0)}%`} title={`Structural load ${(load * 100).toFixed(0)}% of the joint's strength`}
        color={load > 0.85 ? 'var(--bad)' : load > 0.6 ? 'var(--warn)' : 'var(--good)'} tone={load > 0.85 ? 'bad' : load > 0.6 ? 'warn' : undefined} />}
      {e && em?.type === 'engine' && <Bar label="Thrust" value={e.thrust} max={em.maxThrustVac * thrustLimit(p)} right={fmtKN(e.thrust)} color="var(--accent)"
        title={`Thrust ${fmtKN(e.thrust)} of ${fmtKN(em.maxThrustVac * thrustLimit(p))} (vacuum, at the thrust limit)`} />}
      {resources.map(([id, max]) => {
        const have = p.resources[id] ?? 0, name = RESOURCES[id]?.name ?? id;
        return <Bar key={id} label={name} value={have} max={max} color={RESOURCE_COLORS[id] ?? '#aaa'} right={fmtAmount(have)} title={`${name} ${fmtAmount(have)} / ${max.toFixed(0)}`} />;
      })}
      <Chips chips={chips} />
    </div>
    {(toggles.length > 0 || buttons.length > 0) && <div className="insp-section">
      {toggles.length > 0 && <div className="insp-toggles">{toggles.map(t => <OnOff key={t.key} label={t.label} on={t.on} onText={t.text} offText={t.text}
        disabled={!enabled || t.disabled} onClick={() => c.partAction(p.uid, t.action)} />)}</div>}
      {buttons.length > 0 && <div className="insp-actions">{buttons.map(b => <Button key={`${b.action}-${b.experiment ?? ''}`} className={`btn small ${b.danger ? 'danger' : ''}`} disabled={!enabled || b.disabled}
        title={!enabled ? noAuthority : b.disabled ? 'Already done, or requirements not met' : b.label}
        onClick={() => c.partAction(p.uid, b.action, b.experiment)}>{b.label}</Button>)}</div>}
    </div>}
    {(controllable || seats > 0) && <Section title={seats > 0 ? `Crew · ${p.crew?.length ?? 0}/${seats}${freeSeats(p) ? '' : ' full'}` : 'Control'}>
      {controllable && <div className="insp-actions"><Button className={`btn small ${controlling ? 'primary' : ''}`} disabled={!enabled || controlling}
        title="Point the controls, SAS and navball along this part (ports: out of the docking face)" onClick={() => c.controlFrom(p.uid)}>
        {controlling ? '◎ Controlling from here' : '◎ Control from here'}</Button></div>}
      {(p.crew ?? []).map(id => <div key={id} className="insp-crew">
        <span>{crewName(id)}</span>
        {dest.length > 0 && <select aria-label={`Move ${crewName(id)} to`} value="" disabled={!enabled} className="st-move" onChange={e => e.target.value && c.transferCrew(id, +e.target.value)}>
          <option value="">Move to…</option>
          {dest.map(b => <option key={b.uid} value={b.uid}>{b.label} ({b.free} free)</option>)}
        </select>}
      </div>)}
    </Section>}
    {descriptors.length > 0 && <Section title={copies > 1 ? `Settings · all ${copies}` : 'Settings'}>
      <TweakControls descriptors={descriptors} tweaks={shown} onChange={change} disabled={!enabled} />
    </Section>}
    {groups.length > 0 && <Section title="Action groups"><div className="insp-groups">{groups.map(g => <Badge key={g} title={(p.actions?.[g] ?? []).map(a => ACTION_LABELS[a]).join(', ')}>{GROUP_LABELS[g]}</Badge>)}</div></Section>}
    {!enabled && <p className="insp-note">{v.eva ? 'Board a vessel to command parts.' : 'No command authority: actions and settings are unavailable.'}</p>}
  </>;
}
