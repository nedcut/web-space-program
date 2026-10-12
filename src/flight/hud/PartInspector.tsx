import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button } from '../../ui/components';
import { Bar, InspectorLayer, Section, StatRows, TweakControls, type InspectorContent, type InspectorPanelProps } from '../../ui/inspector/Inspector';
import { RESOURCE_COLORS } from '../../ui/inspector/resources';
import { RESOURCES } from '../../data/resources';
import { ACTION_GROUP_IDS, ACTION_LABELS, GROUP_LABELS, actionAvailable, actionState, partActions } from '../../sim/vessel/actions';
import { crossfeedOpen, isExtended, thrustLimit, tweakDescriptors } from '../../sim/vessel/tweaks';
import type { PartState } from '../../sim/vessel/runtime';
import type { PartActionId, PartTweaks, ResourceId } from '../../sim/vessel/types';
import type { FlightController } from '../controller';
import { game } from '../../game/store';

const fmtKN = (n: number) => (n < 1000 ? `${n.toFixed(0)} N` : `${(n / 1000).toFixed(n < 1e5 ? 1 : 0)} kN`);
const CHUTE_PHASE: Record<string, string> = { stowed: 'Stowed', armed: 'Armed — waiting for air', semi: 'Partly open', full: 'Fully open', cut: 'Cut away' };

/** Flight part inspectors: right-click / long-press a part of the active vessel. */
export function FlightInspector({ controller: c, panels, setPanels }: { controller: FlightController; panels: InspectorPanelProps[]; setPanels: (fn: (p: InspectorPanelProps[]) => InspectorPanelProps[]) => void }) {
  const [, refresh] = useState(0);
  useEffect(() => c.onPartPick(uid => setPanels(p => [...p.filter(x => x.pinned && x.uid !== uid), { uid, pinned: p.find(x => x.uid === uid)?.pinned ?? false }])), [c, setPanels]);
  // Live readouts at ~6 Hz; panels of parts that left the active vessel close themselves.
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
  const content = (uid: number): InspectorContent | null => {
    const v = c.world.active?.state;
    const p = v?.cache.byUid.get(uid);
    if (!v || !p) return null;
    const copies = p.symmetryGroup === undefined ? 1 : v.parts.filter(q => q.symmetryGroup === p.symmetryGroup && q.partId === p.partId).length;
    return { title: p.def.name, partId: p.def.id, subtitle: `${p.def.manufacturer}${copies > 1 ? ` · symmetry ×${copies}` : ''}`, body: <FlightPartBody c={c} part={p} copies={copies} /> };
  };
  if (c.mapMode) return null;
  return <InspectorLayer panels={panels} anchor={anchor} content={content}
    onClose={uid => setPanels(p => p.filter(x => x.uid !== uid))}
    onPin={uid => setPanels(p => p.map(x => (x.uid === uid ? { ...x, pinned: !x.pinned } : x)))}
    insets={{ top: 110, right: 350, bottom: game.get().settings.navballSize + 70, left: 240 }} />;
}

function FlightPartBody({ c, part: p, copies }: { c: FlightController; part: PartState; copies: number }) {
  const wv = c.world.active!;
  const v = wv.state;
  const enabled = c.world.canControl(v) && !v.eva && (!c.network || c.network.ownId === v.id);
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

  const rows: [string, string, ('good' | 'warn' | 'bad' | undefined)?][] = [];
  const e = p.engine;
  const em = e ? p.def.modules[e.moduleIndex] : undefined;
  if (e && em?.type === 'engine') {
    const limit = thrustLimit(p);
    rows.push(['Engine', e.flamedOut ? 'Flamed out' : e.ignited ? 'Running' : e.ignitionsLeft === 0 ? 'No ignitions left' : 'Off', e.flamedOut ? 'bad' : e.ignited ? 'good' : undefined]);
    rows.push(['Thrust', `${fmtKN(e.thrust)} / ${fmtKN(em.maxThrustVac * limit)}`]);
    rows.push(['Isp', `${e.isp.toFixed(0)} s`]);
    if (e.ignitionsLeft >= 0) rows.push(['Ignitions left', String(e.ignitionsLeft)]);
  }
  if (p.chute) rows.push(['Parachute', CHUTE_PHASE[p.chute.phase] ?? p.chute.phase, p.chute.phase === 'cut' ? 'warn' : undefined]);
  if (p.leg || p.wheel || p.bayOpen !== undefined || p.def.modules.some(m => (m.type === 'solarPanel' && m.tracking) || m.type === 'antenna')) {
    const out = actionState(p, 'deploy.toggle');
    const moving = p.panelDeploy !== undefined && p.panelDeploy > 0 && p.panelDeploy < 1;
    rows.push(['Deployed', p.panelTorn ? 'Torn off' : moving ? (out ? 'Extending…' : 'Retracting…') : out ? 'Extended' : 'Retracted', p.panelTorn ? 'bad' : undefined]);
  }
  if (p.def.modules.some(m => m.type === 'decoupler' || m.type === 'dockingPort')) rows.push(['Crossfeed', crossfeedOpen(p) ? 'Open' : 'Closed']);
  if (p.docked) rows.push(['Docked', p.docked.vesselName]);
  if (p.scienceData?.length) rows.push(['Science data', `${p.scienceData.length} stored`]);
  if (p.electronicsFailed) rows.push(['Electronics', 'Failed (radiation)', 'bad']);
  else if (p.electronicsDegraded) rows.push(['Electronics', 'Degraded', 'warn']);
  const skin = Math.max(p.temperature, ...p.skinTemperature);
  const heat = skin / p.maxTemp;
  const load = v.cache.jointLoads?.get(p.uid)?.fraction;
  const resources = (Object.entries(p.maxResources) as [ResourceId, number][]).filter(([id, max]) => id !== 'intakeAir' && max > 0);

  const buttons: { action: PartActionId; label: string; experiment?: string; danger?: boolean; disabled?: boolean }[] = [];
  for (const a of partActions(p.def)) {
    if (!actionAvailable(p, a)) {
      buttons.push({ action: a, label: `${ACTION_LABELS[a]} — unavailable`, disabled: true });
      continue;
    }
    switch (a) {
      case 'engine.activate': buttons.push({ action: a, label: 'Activate engine' }); break;
      case 'engine.shutdown': buttons.push({ action: a, label: 'Shut down' }); break;
      case 'deploy.toggle': buttons.push({ action: a, label: actionState(p, a) ? 'Retract' : 'Extend' }); break;
      case 'decouple': buttons.push({ action: a, label: 'Decouple', danger: true }); break;
      case 'fairing.jettison': buttons.push({ action: a, label: 'Jettison', danger: true }); break;
      case 'chute.deploy': buttons.push({ action: a, label: 'Arm parachute' }); break;
      case 'chute.cut': buttons.push({ action: a, label: 'Cut parachute', danger: true }); break;
      case 'drill.toggle': buttons.push({ action: a, label: p.drillDeployed ? 'Retract drill' : 'Deploy drill' }); break;
      case 'converter.toggle': buttons.push({ action: a, label: p.converterRunning ? 'Stop converter' : 'Start converter' }); break;
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
  const groups = ACTION_GROUP_IDS.filter(g => p.actions?.[g]?.length);
  return <>
    <Section title="Status">
      <Bar label="Temperature" value={skin} max={p.maxTemp} right={`${skin.toFixed(0)} / ${p.maxTemp.toFixed(0)} K`} color={heat > 0.9 ? 'var(--bad)' : heat > 0.7 ? 'var(--warn)' : '#ff9a5c'} tone={heat > 0.9 ? 'bad' : heat > 0.7 ? 'warn' : undefined} />
      {load !== undefined && <Bar label="Structural load" value={load} max={1} right={`${(load * 100).toFixed(0)}%`} color={load > 0.85 ? 'var(--bad)' : load > 0.6 ? 'var(--warn)' : 'var(--good)'} tone={load > 0.85 ? 'bad' : load > 0.6 ? 'warn' : undefined} />}
      {rows.length > 0 && <StatRows rows={rows} />}
    </Section>
    {resources.length > 0 && <Section title="Contents">
      {resources.map(([id, max]) => <Bar key={id} label={RESOURCES[id]?.name ?? id} value={p.resources[id] ?? 0} max={max} color={RESOURCE_COLORS[id] ?? '#aaa'}
        right={`${(p.resources[id] ?? 0).toFixed((p.resources[id] ?? 0) < 10 ? 1 : 0)} / ${max.toFixed(0)}`} />)}
    </Section>}
    {buttons.length > 0 && <Section title="Actions">
      <div className="insp-actions">{buttons.map(b => <Button key={`${b.action}-${b.experiment ?? ''}`} className={`btn small ${b.danger ? 'danger' : ''}`} disabled={!enabled || b.disabled}
        title={!enabled ? 'No command authority' : b.disabled ? 'Already active, expended, or requirements not met; check Status above' : b.label}
        onClick={() => c.partAction(p.uid, b.action, b.experiment)}>{b.label}</Button>)}</div>
    </Section>}
    {descriptors.length > 0 && <Section title={copies > 1 ? `Settings · all ${copies}` : 'Settings'}>
      <TweakControls descriptors={descriptors} tweaks={shown} onChange={change} disabled={!enabled} />
    </Section>}
    {groups.length > 0 && <Section title="Action groups"><div className="insp-groups">{groups.map(g => <Badge key={g} title={(p.actions?.[g] ?? []).map(a => ACTION_LABELS[a]).join(', ')}>{GROUP_LABELS[g]}</Badge>)}</div></Section>}
    {!enabled && <p className="insp-note">{v.eva ? 'Board a vessel to command parts.' : 'No command authority: actions and settings are unavailable.'}</p>}
  </>;
}
