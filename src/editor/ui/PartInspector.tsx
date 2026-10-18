import { useCallback, useEffect, useRef } from 'react';
import { Badge, Button, Slider } from '../../ui/components';
import { InspectorLayer, Section, StatRows, TweakControls, type InspectorContent } from '../../ui/inspector/Inspector';
import { RESOURCE_COLORS } from '../../ui/inspector/resources';
import { ACTION_GROUP_IDS, ACTION_LABELS, GROUP_LABELS, partActions } from '../../sim/vessel/actions';
import { thrustLimit, tweakDescriptors } from '../../sim/vessel/tweaks';
import type { PartDef, PartInstance, ResourceId } from '../../sim/vessel/types';
import { CATALOG, DENSITIES, type EditorSession, type SessionView } from '../session';
import { IS_MAC, type EditorView } from '../scene/EditorView';
import type { EditorTool } from '../session';

const TOOL_TIPS: Record<EditorTool, string> = {
  place: `Click: pick up with attached · ${IS_MAC ? '⌘' : 'Ctrl'}+click: just this part · ${IS_MAC ? '⌥' : 'Alt'}+click: copy`, offset: 'Click: move with the gizmo', rotate: 'Click: rotate with the gizmo', reroot: 'Click: make root',
};
import { RESOURCE_SHORT, fmtKN, fmtKg } from './partInfo';

const engineOf = (def: PartDef) => def.modules.find(m => m.type === 'engine');
function partMass(p: PartInstance, def: PartDef): { wet: number; dry: number } {
  let wet = def.dryMass;
  const res = { ...def.resources, ...p.resources };
  for (const k in res) wet += (res[k as ResourceId] ?? 0) * (DENSITIES[k as ResourceId] ?? 0);
  return { wet, dry: def.dryMass };
}

/** Floating editor panels for the parts the player right-clicked (or clicked in action-group mode). */
export function EditorInspector({ session, view, getView }: { session: EditorSession; view: SessionView; getView: () => EditorView | null }) {
  const anchor = useCallback((uid: number) => getView()?.partScreenPosition(uid) ?? null, [getView]);
  const content = (uid: number): InspectorContent | null => {
    // A part of the craft or of a set-aside piece (edited in place, but it won't launch).
    const parts = [view.craft, ...view.detached].find(a => a.parts.some(p => p.uid === uid))?.parts ?? [];
    const part = parts.find(p => p.uid === uid);
    const def = part && CATALOG.get(part.partId);
    if (!part || !def) return null;
    const copies = part.symmetryGroup === undefined ? 1 : parts.filter(p => p.symmetryGroup === part.symmetryGroup && p.partId === part.partId).length;
    const aside = parts !== view.craft.parts ? ' · set aside' : '';
    return { title: def.name, partId: def.id, subtitle: `${def.name} · ${def.manufacturer}${copies > 1 ? ` · symmetry ×${copies}` : ''}${aside}`, badge: copies > 1 ? `×${copies}` : undefined,
      body: <EditorPartBody session={session} view={view} part={part} def={def} copies={copies} /> };
  };
  return <InspectorLayer panels={view.panels} anchor={anchor} content={content} onClose={uid => session.closePanel(uid)} onPin={uid => session.togglePin(uid)}
    insets={{ top: 74, right: 270, bottom: 60, left: 338 }} />;
}

function EditorPartBody({ session, view, part, def, copies }: { session: EditorSession; view: SessionView; part: PartInstance; def: PartDef; copies: number }) {
  const mass = partMass(part, def);
  const engine = engineOf(def);
  const limit = thrustLimit({ def, tweaks: part.tweaks });
  const stageIndex = view.stages.find(s => s.partUids.includes(part.uid));
  const descriptors = tweakDescriptors(def);
  const actions = partActions(def);
  const resources = Object.entries(def.resources).filter(([id, max]) => id !== 'intakeAir' && (max ?? 0) > 0) as [ResourceId, number][];
  const inGroups = ACTION_GROUP_IDS.filter(g => part.actions?.[g]?.length);
  const rows: [string, string][] = [
    ['Mass', resources.length ? `${fmtKg(mass.wet)} (dry ${fmtKg(mass.dry)})` : fmtKg(mass.wet)],
    ['Cost', `${def.cost.toLocaleString('en-US')} cr`],
  ];
  if (stageIndex) rows.push(['Stage', String(view.stages.length - 1 - stageIndex.index)]);
  if (engine && engine.type === 'engine') {
    rows.push(['Thrust', `${fmtKN(engine.maxThrustVac * limit)} vac${limit < 1 ? ` (${Math.round(limit * 100)}%)` : ''}`]);
    rows.push(['Isp', engine.airBreathing ? `${engine.ispVac.toFixed(0)} s` : `${engine.ispAsl.toFixed(0)} – ${engine.ispVac.toFixed(0)} s`]);
  }
  rows.push(['Max temperature', `${def.maxTemp.toFixed(0)} K`], ['Impact tolerance', `${def.crashTolerance} m/s`]);
  return <>
    <Section title={copies > 1 ? `Part · settings apply to all ${copies}` : 'Part'}><StatRows rows={rows} /></Section>
    {resources.length > 0 && <Section title="Contents" aside={<span className="insp-actions">
      <Button className="btn small ghost" title="Fill every resource" onClick={() => session.setPartResources(part.uid, Object.fromEntries(resources.map(([id, max]) => [id, max])))}>Fill</Button>
      <Button className="btn small ghost" title="Empty every resource (ballast / dry tests)" onClick={() => session.setPartResources(part.uid, Object.fromEntries(resources.map(([id]) => [id, 0])))}>Empty</Button>
    </span>}>
      {resources.map(([id, max]) => {
        const amount = part.resources?.[id] ?? max;
        return <label key={id} className="insp-row slider">
          <span style={{ color: RESOURCE_COLORS[id] }}>{RESOURCE_SHORT[id]}</span>
          <span className="mono">{amount.toFixed(amount < 10 ? 1 : 0)} / {max.toFixed(0)}</span>
          <Slider aria-label={`${RESOURCE_SHORT[id]} amount`} min={0} max={max} step={max / 200} value={amount} onChange={e => session.setPartResources(part.uid, { [id]: Number(e.target.value) })} />
        </label>;
      })}
    </Section>}
    {descriptors.length > 0 && <Section title="Settings"><TweakControls descriptors={descriptors} tweaks={part.tweaks} onChange={t => session.setPartTweaks(part.uid, t)} /></Section>}
    {actions.length > 0 && (view.mode === 'actions'
      ? <Section title="Action group" aside={<select aria-label="Action group" className="insp-select" value={view.group} onChange={e => session.setGroup(e.target.value as SessionView['group'])}>
          {ACTION_GROUP_IDS.map(g => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
        </select>}>
        <div className="insp-checks">{actions.map(a => <label key={a} className="insp-check">
          <input type="checkbox" checked={!!part.actions?.[view.group]?.includes(a)} onChange={() => session.toggleGroupAction(part.uid, a)} />
          {ACTION_LABELS[a]}
        </label>)}</div>
        <p className="insp-note">{copies > 1 ? `Applies to all ${copies} symmetric parts. ` : ''}Fires with the {GROUP_LABELS[view.group]} group in flight.</p>
      </Section>
      : <Section title="Action groups" aside={<Button className="btn small ghost" onClick={() => { session.setMode('actions'); }}>Edit</Button>}>
        {inGroups.length ? <div className="insp-groups">{inGroups.map(g => <Badge key={g} title={(part.actions?.[g] ?? []).map(a => ACTION_LABELS[a]).join(', ')}>{GROUP_LABELS[g]}</Badge>)}</div>
          : <p className="insp-note">Not in any group. Available: {actions.slice(0, 4).map(a => ACTION_LABELS[a].toLowerCase()).join(', ')}{actions.length > 4 ? '…' : ''}.</p>}
      </Section>)}
  </>;
}

/** Hover tooltip that follows the pointer over a part (name, mass, stage). */
export function HoverTooltip({ view, getView }: { view: SessionView; getView: () => EditorView | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = ref.current, p = getView()?.pointer();
      if (!el) return;
      el.style.visibility = p ? 'visible' : 'hidden';
      if (p) el.style.transform = `translate(${Math.round(p.x + 16)}px, ${Math.round(p.y + 18)}px)`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getView]);
  const part = view.hoverUid === null || view.held ? null : view.craft.parts.find(p => p.uid === view.hoverUid);
  const def = part && CATALOG.get(part.partId);
  if (!part || !def || view.panels.some(p => p.uid === part.uid)) return null;
  const stage = view.stages.find(s => s.partUids.includes(part.uid));
  return <div ref={ref} className="vab-hover-tip panel" role="tooltip">
    <strong>{def.name}</strong>
    <span className="mono">{fmtKg(partMass(part, def).wet)}{stage ? ` · stage ${view.stages.length - 1 - stage.index}` : ''}</span>
    <span className="dim">{view.mode === 'actions' ? 'Click to assign actions' : `${TOOL_TIPS[view.tool]} · ${IS_MAC ? 'Ctrl+click' : 'Right-click'}: details`}</span>
  </div>;
}
