import { Button, Panel } from '../../ui/components';
import { Icon } from '../../ui/components/Icon';
import { ACTION_GROUP_IDS, ACTION_LABELS, GROUP_LABELS } from '../../sim/vessel/actions';
import type { ActionGroupId } from '../../sim/vessel/types';
import { bindingLabel, type Action } from '../../input/bindings';
import { CATALOG, type EditorSession, type SessionView } from '../session';

const KEY: Partial<Record<ActionGroupId, Action>> = {
  gear: 'toggleGear', brakes: 'brakes', lights: 'toggleLights', rcs: 'toggleRcs', sas: 'toggleSas', abort: 'abort', stage: 'stage',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`custom${i + 1}`, `actionGroup${i + 1}`])),
};
const HINT: Partial<Record<ActionGroupId, string>> = {
  stage: 'Fires every time the next stage is activated.',
  gear: 'Fires with the landing gear toggle (also moves all gear).',
  brakes: 'On while the brakes are held, off on release.',
  lights: 'Also switches every lamp on the vessel.',
  rcs: 'Follows the RCS toggle.', sas: 'Follows the SAS toggle.',
  abort: 'Cuts the throttle and fires once. Wire escape motors, decouplers and parachutes here.',
};

/** Action-group editing mode: group list, per-group bindings and the click-to-assign hint. */
export function ActionGroupsPanel({ session, view }: { session: EditorSession; view: SessionView }) {
  const counts = new Map(ACTION_GROUP_IDS.map(g => [g, view.craft.parts.reduce((n, p) => n + (p.actions?.[g]?.length ?? 0), 0)]));
  const bindings = view.craft.parts.flatMap(p => (p.actions?.[view.group] ?? []).map(a => ({ part: p, action: a })));
  const key = KEY[view.group];
  return (
    <Panel className="vab-palette vab-groups panel" aria-label="Action groups">
      <div className="vab-groups-list" role="listbox" aria-label="Action group">
        <div className="vab-groups-head"><Icon name="groups" size={16} /><span className="label">Groups</span></div>
        {ACTION_GROUP_IDS.map(g => (
          <Button key={g} role="option" aria-selected={view.group === g} className={`vab-group-item ${view.group === g ? 'on' : ''} ${g === 'abort' ? 'abort' : ''}`} onClick={() => session.setGroup(g)}>
            <span>{GROUP_LABELS[g]}</span>
            {counts.get(g) ? <span className="vab-group-count mono">{counts.get(g)}</span> : null}
          </Button>
        ))}
      </div>
      <div className="vab-groups-detail">
        <div className="vab-groups-title">
          <div>
            <div className="label">Action group</div>
            <h3>{GROUP_LABELS[view.group]}</h3>
          </div>
          {key && <kbd title="Flight key (rebind in Settings → Controls)">{bindingLabel(key)}</kbd>}
        </div>
        <p className="vab-groups-hint">{HINT[view.group] ?? 'Toggles its actions on, then off, with each press.'} Click a part in the hangar to choose what it does.</p>
        <div className="vab-groups-bindings">
          {bindings.map(({ part, action }) => (
            <div key={`${part.uid}-${action}`} className="vab-binding" onMouseEnter={() => session.setHighlight([part.uid])} onMouseLeave={() => session.setHighlight([])}>
              <button type="button" className="vab-binding-main" onClick={() => session.openPanel(part.uid)} title="Show part">
                <span>{CATALOG.get(part.partId)?.name}</span>
                <small>{ACTION_LABELS[action]}</small>
              </button>
              <Button className="insp-icon" title="Remove from group" aria-label="Remove" onClick={() => { session.setHighlight([]); session.toggleGroupAction(part.uid, action); }}><Icon name="close" size={13} /></Button>
            </div>
          ))}
          {!bindings.length && <div className="vab-empty">No actions yet.</div>}
        </div>
        <div className="vab-groups-foot">
          <Button className="btn small ghost" disabled={!bindings.length} onClick={() => session.clearGroup(view.group)}>Clear group</Button>
          <Button className="btn small primary" onClick={() => session.setMode('build')}>Done</Button>
        </div>
      </div>
    </Panel>
  );
}
