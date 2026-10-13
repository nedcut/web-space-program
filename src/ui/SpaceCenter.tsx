import { Icon } from './components/Icon';
import { Panel, Button, Kbd, Modal, PromptModal } from './components';
import { photoMode, usePhotoMode } from '../game/photoMode';
import { openProgram } from '../game/program';
import { saveNamedWorld } from '../game/persistence';
import { saveErrorText } from '../game/storageErrors';
import { newProgression } from '../sim/science/progression';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { game, launchableCraft, useGame } from '../game/store';
import type { SiteObjectId } from '../render/site/LaunchSite';
import { HubBackdrop, type BuildingLabel } from './hub/HubBackdrop';
import { DebriefCard } from './hub/DebriefCard';
import { HubMenu, type HubMenuAction } from './hub/HubMenu';
import { pendingDebrief, setPendingDebrief, type FlightDebrief } from './hub/debrief';
import { facilityForBuilding, hubFacilities, type HubFacility, type HubFacilityId } from './hub/facilities';
import { launchBlocker } from './hub/quickLaunch';
import { nextGoal } from './hub/nextGoal';
import { SettingsPanel } from './MainMenu';
import { SaveLoadDialog } from './SaveLoadDialog';
import { formatDate } from './format';
import { arrowNav } from './nav/arrowNav';
import { useEscape } from './nav/escape';
import './nav/nav.css';

const LaunchPicker = lazy(() => import('./hub/LaunchPicker'));
const ICON: Record<HubFacilityId, string> = { editor: 'build', launch: 'rocket', flightlog: 'log', tracking: 'orbit', research: 'science', missions: 'groups' };
type Overlay = 'menu' | 'settings' | 'save' | 'load' | 'launch' | null;

/** Hub screen over a live 3D view of the launch complex. */
export function SpaceCenter() {
  const mode = useGame(s => s.mode);
  const p = useGame(s => s.resumeWorld?.progression);
  const [notice, setNotice] = useState(() => game.get().notice ?? '');
  useEffect(() => { if (game.get().notice) game.set({ notice: null }); }, []);
  const [debrief, setDebrief] = useState<FlightDebrief | null>(pendingDebrief);
  useEffect(() => setPendingDebrief(null), []);
  const ut = useGame((s) => s.ut);
  const craft = useGame((s) => launchableCraft(s.craft));
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [highlight, setHighlight] = useState<SiteObjectId | null>(null);
  const photo = usePhotoMode().active;
  const scale = useGame(s => s.scalePreset);
  // Program state only changes between visits; recompute on milestones, research and the contract desk.
  const goal = useMemo(() => p ? nextGoal(p, mode, scale) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p, mode, scale, p?.milestones.length, p?.unlocked.length, p?.contracts.length, Math.floor(p?.science ?? 0)]);

  const all = hubFacilities(mode, craft?.type === 'SPH');
  const tiles = all.filter(f => !f.closed);
  const describe = (f: HubFacility) =>
    f.id === 'launch' ? (craft ? `Ready: ${craft.name} · or pick another` : 'Pick a vehicle and fly')
      : f.id === 'research' ? `${(p?.science ?? 0).toFixed(1)} science · ${f.desc}` : f.desc;
  const enter = (id: HubFacilityId) => {
    if (id === 'launch') setOverlay('launch');
    else game.set({ scene: id });
  };
  const launchAgain = (c: FlightDebrief['craft']) => {
    if (!c) return;
    const problem = launchBlocker(c, mode, p ?? newProgression());
    if (problem) { setDebrief(null); setNotice(`${c.name}: ${problem}`); }
    else game.set({ craft: c, scene: 'flight', launchPending: true });
  };

  // Latest values for the 3D scene's callbacks and the key listener (registered once).
  const live = useRef({ all, tiles, enter });
  live.current = { all, tiles, enter };
  const onPick = (id: SiteObjectId) => {
    const f = facilityForBuilding(live.current.all, id);
    if (!f) return;
    if (f.closed) setNotice(`${f.title} opens in ${f.closed.toLowerCase()}.`);
    else live.current.enter(f.id);
  };
  const label = (id: SiteObjectId): BuildingLabel | null => {
    const f = facilityForBuilding(live.current.all, id);
    if (!f) return null;
    const key = live.current.tiles.indexOf(f);
    return f.closed ? { title: f.title, detail: `${f.closed} only`, closed: true } : { title: f.title, detail: describe(f), key: key >= 0 ? String(key + 1) : undefined };
  };

  // Number keys enter the facility on the matching tile (shown on each tile).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || photoMode.get().active || document.querySelector('[data-settings-modal], dialog[open]')) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
      const tile = /^Digit[1-9]$/.test(e.code) ? live.current.tiles[+e.code.slice(5) - 1] : undefined;
      if (!tile) return;
      e.preventDefault();
      live.current.enter(tile.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Esc opens the hub menu (the debrief card, when shown, takes the first Esc).
  useEscape(() => setOverlay('menu'), overlay === null && !photo, 'screen');
  const act = (a: HubMenuAction) => {
    if (a === 'pedia') void import('./Spacepedia').then(m => m.openPedia('spaceCenter'));
    else if (a === 'menu') game.set({ scene: 'menu' });
    else setOverlay(a);
  };

  return (
    <div className="fullscreen">
      <HubBackdrop onPick={onPick} label={label} highlight={highlight} />
      <div className="fullscreen photo-hide hub-composition">
        <div className="hub-header">
          <div>
            <div className="label">Coastal Launch Complex</div>
            <h2 style={{ fontWeight: 300, letterSpacing: '0.2em', margin: '6px 0 0' }}>SPACE CENTER</h2>
          </div>
          <div className="mono" style={{ color: 'var(--text)', textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>{formatDate(ut)}</div>
        </div>
        <div style={{ marginTop: 16, textShadow: '0 1px 6px rgba(0,0,0,0.8)' }} className="mono">{mode.toUpperCase()}{mode === 'career' && ` · ${(p?.funds ?? 60000).toLocaleString()} cr · ${p?.reputation ?? 0} reputation`}</div>
        {goal && !debrief && <section className="panel hub-goal" aria-label="Next goal">
          <div className="label">Next goal</div>
          <h3>{goal.title}</h3>
          <p>{goal.detail}</p>
          <div className="hub-goal-actions">
            <Button className="btn small primary" onClick={() => enter(goal.action)}>{goal.actionLabel}</Button>
            {goal.aside && <Button className="btn small ghost" onClick={() => enter('missions')}>{goal.aside}</Button>}
          </div>
        </section>}
        <div style={{ flex: 1 }} />
        {debrief && <DebriefCard debrief={debrief}
          onOpenLog={() => game.set({ scene: 'flightlog' })}
          onLaunchAgain={debrief.craft ? () => launchAgain(debrief.craft) : null}
          onDismiss={() => setDebrief(null)} />}
        {notice && <Panel role="status" className="panel" style={{ alignSelf: 'flex-start', padding: '8px 14px', marginBottom: 12, background: 'rgba(8, 13, 22, 0.85)' }}>{notice}</Panel>}
        <div className="hub-tiles" onKeyDown={e => arrowNav(e)} onMouseLeave={() => setHighlight(null)} onBlur={() => setHighlight(null)}>
          {tiles.map((t, i) => (
            <Button
              key={t.id}
              className="panel btn hub-tile"
              onClick={() => enter(t.id)}
              onMouseEnter={() => setHighlight(t.building)}
              onFocus={() => setHighlight(t.building)}
              aria-keyshortcuts={String(i + 1)}
            >
              <Icon name={ICON[t.id]} size={24} />
              <strong>{t.title}</strong><small>{describe(t)}</small><span className="kbd hub-key" aria-hidden="true">{i + 1}</span>
            </Button>
          ))}
        </div>
        <div className="hub-actions">
          <Button className="btn small" onClick={() => setOverlay('menu')}>Menu <Kbd>Esc</Kbd></Button>
          <Button className="btn small" onClick={() => act('pedia')}>Spacepedia</Button>
          <Button className="btn small" onClick={() => photoMode.open()}>Photo mode</Button>
          <Button className="btn small" onClick={() => setOverlay('settings')}>Settings</Button>
        </div>
        {overlay === 'menu' && <HubMenu onClose={() => setOverlay(null)} act={act} />}
        {overlay === 'settings' && <SettingsPanel onClose={() => setOverlay(null)} />}
        {overlay === 'load' && <Modal title="Load a program" onClose={() => setOverlay(null)} className="hub-load"><SaveLoadDialog onClose={() => setOverlay(null)} /></Modal>}
        {overlay === 'launch' && <Suspense fallback={null}><LaunchPicker onClose={() => setOverlay(null)} /></Suspense>}
        {overlay === 'save' && <PromptModal title="Save program" label="Save slot name" initial="Program save" onCancel={() => setOverlay(null)}
          onSubmit={name => { setOverlay(null); try { saveNamedWorld(name, openProgram()); setNotice('Program saved.'); } catch (e) { setNotice(saveErrorText(e)); } }} />}
      </div>
    </div>
  );
}
