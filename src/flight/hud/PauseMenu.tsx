import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, ConfirmModal, Kbd, PromptModal } from '../../ui/components';
import { arrowNav, focusFirst } from '../../ui/nav/arrowNav';
import { useEscape } from '../../ui/nav/escape';
import { bindingLabel } from '../../input/bindings';
import './hud.css';

/** What the pause menu may offer; computed by the flight scene from the current flight. */
export interface PauseMenuModel {
  /** Vessel destroyed: Resume is replaced by the ways back (quickload, revert, leave); Esc closes the menu. */
  lost: boolean;
  /** Practice run (lesson or challenge): no saves, no recovery, no revert to the editor. */
  practice: 'lesson' | 'challenge' | null;
  /** Vessel name and one-line situation for the header. */
  title?: { name: string; sub: string } | null;
  canRecover: boolean;
  /** This flight was launched from a craft (not resumed from a save), so it can be reverted. */
  canRevert: boolean;
  hasQuicksave: boolean;
}

export interface PauseMenuActions {
  resume(): void;
  photo(): void;
  recover(): void;
  revertToLaunch(): void;
  revertToEditor(): void;
  saveAs(name: string): void;
  quicksave(): void;
  quickload(): void;
  controls(): void;
  settings(): void;
  leave(): void;
}

type Pending = 'revertLaunch' | 'revertEditor' | 'saveAs' | null;

/** Buttons for each pause-menu group, in display order. Pure, so the menu's structure is unit tested. */
export function pauseMenuGroups(m: PauseMenuModel): { id: 'flight' | 'program' | 'options'; items: string[] }[] {
  const flight: string[] = [];
  if (m.practice === 'lesson') flight.push('restart');
  else if (m.practice === 'challenge') flight.push('restart');
  else {
    if (m.canRevert) flight.push('revertLaunch', 'revertEditor');
    if (m.canRecover) flight.push('recover');
  }
  const program: string[] = [];
  if (!m.practice && !m.lost) program.push('quicksave', 'saveAs');
  if (!m.practice && m.hasQuicksave && !m.lost) program.push('quickload');
  const options = [...(m.lost ? [] : ['photo']), 'controls', 'settings'];
  return [{ id: 'flight' as const, items: flight }, { id: 'program' as const, items: program }, { id: 'options' as const, items: options }].filter(g => g.items.length > 0);
}

const GROUP_LABEL = { flight: 'Flight', program: 'Program', options: 'Options' };

/**
 * Flight pause menu: Resume first, then grouped actions (Flight · Program · Options) and Leave last. Reverts
 * ask first; "Save as…" uses the in-game prompt. Esc resumes, or closes an open confirmation first; arrow keys
 * move between buttons.
 */
export function PauseMenu({ model: m, act }: { model: PauseMenuModel; act: PauseMenuActions }) {
  const [pending, setPending] = useState<Pending>(null);
  const card = useRef<HTMLDivElement>(null);
  useEscape(act.resume, pending === null, 'modal');
  useEffect(() => { focusFirst(card.current); }, []);
  const restart = m.practice === 'lesson' ? 'Restart lesson' : 'Restart challenge';
  const button = (id: string): ReactNode => {
    switch (id) {
      case 'restart': return <Button key={id} className="btn" onClick={act.revertToLaunch}>{restart}</Button>;
      // A destroyed vessel has no progress left to lose: revert without asking.
      case 'revertLaunch': return <Button key={id} className={`btn ${m.lost && !m.hasQuicksave ? 'primary' : ''}`} onClick={() => (m.lost ? act.revertToLaunch() : setPending('revertLaunch'))}>Revert to launch</Button>;
      case 'revertEditor': return <Button key={id} className="btn" onClick={() => (m.lost ? act.revertToEditor() : setPending('revertEditor'))}>Revert to editor</Button>;
      case 'recover': return <Button key={id} className="btn" onClick={act.recover}>Recover vessel</Button>;
      case 'quicksave': return <Button key={id} className="btn" onClick={act.quicksave}>Quicksave <Kbd>F5</Kbd></Button>;
      case 'saveAs': return <Button key={id} className="btn" onClick={() => setPending('saveAs')}>Save as…</Button>;
      case 'quickload': return <Button key={id} className="btn" onClick={act.quickload}>Quickload <Kbd>F9</Kbd></Button>;
      case 'photo': return <Button key={id} className="btn" onClick={act.photo}>Photo mode <Kbd>{bindingLabel('photoMode')}</Kbd></Button>;
      case 'controls': return <Button key={id} className="btn" onClick={act.controls}>Controls <Kbd>{bindingLabel('help')}</Kbd></Button>;
      case 'settings': return <Button key={id} className="btn" onClick={act.settings}>Settings</Button>;
      default: return null;
    }
  };
  const leave = m.practice === 'lesson' ? 'Back to lessons' : m.practice === 'challenge' ? 'Back to challenges' : 'Space Center';
  return (
    <>
      <div ref={card} className="panel pause-card pause-menu" role="dialog" aria-label={m.lost ? 'Vessel lost' : 'Paused'} onKeyDown={arrowNav}>
        <div className="pause-head">
          <div className={`label${m.lost ? ' bad' : ''}`}>{m.lost ? 'Vessel lost' : 'Paused'}</div>
          {m.title && <div className="pause-title">{m.title.name}<span>{m.title.sub}</span></div>}
        </div>
        {!m.lost && <Button className="btn primary pause-resume" onClick={act.resume}>Resume <Kbd>Esc</Kbd></Button>}
        {m.lost && !m.practice && m.hasQuicksave && <Button className="btn primary pause-resume" onClick={act.quickload}>Load quicksave <Kbd>F9</Kbd></Button>}
        {pauseMenuGroups(m).map(g => (
          <section key={g.id} className="pause-group" aria-label={GROUP_LABEL[g.id]}>
            <div className="label">{GROUP_LABEL[g.id]}</div>
            <div className="pause-grid">{g.items.map(button)}</div>
          </section>
        ))}
        <Button className="btn pause-leave" onClick={act.leave}>← {leave}</Button>
        <div className="pause-note">{m.practice ? 'Practice is separate from your saved program.' : 'Progress is autosaved when you leave flight.'}</div>
      </div>
      {pending === 'revertLaunch' && <ConfirmModal title="Revert to launch?" confirmLabel="Revert to launch" danger onCancel={() => setPending(null)} onConfirm={() => { setPending(null); act.revertToLaunch(); }}>
        This flight is discarded and the craft goes back on the pad. Everything else returns to how it was at launch.
      </ConfirmModal>}
      {pending === 'revertEditor' && <ConfirmModal title="Revert to editor?" confirmLabel="Revert to editor" danger onCancel={() => setPending(null)} onConfirm={() => { setPending(null); act.revertToEditor(); }}>
        This flight is discarded and the craft returns to the editor. Everything else returns to how it was at launch.
      </ConfirmModal>}
      {pending === 'saveAs' && <PromptModal title="Save flight" label="Save name" initial="Mission save" onCancel={() => setPending(null)} onSubmit={(name) => { setPending(null); act.saveAs(name); }} />}
    </>
  );
}
