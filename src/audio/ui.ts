import { useEffect } from 'react';
import { GameAudio } from './index';
import { game, useGame } from '../game/store';
import { selectTheme } from './situation';

let shared: GameAudio | undefined;
/** One browser context for all scenes; never constructed merely by importing a module. */
export function getGameAudio(): GameAudio { return shared ??= new GameAudio(); }

/** Delegated listeners cover native/React buttons, including lazy scenes and keyboard activation. */
export function useInterfaceAudio(): void {
  const scene = useGame(s => s.scene);
  useEffect(() => {
    const audio = getGameAudio();
    if (scene !== 'flight') {
      audio.setPaused(false);
      audio.silenceFlight();
      audio.setMusic(selectTheme({ scene, bodyId: game.get().resumeWorld?.vessels.find(v => v.state.id === game.get().resumeWorld?.activeId)?.body }));
    }
  }, [scene]);
  useEffect(() => {
    const audio = getGameAudio();
    const button = (target: EventTarget | null) => target instanceof Element ? target.closest('button, [role="button"], input[type="range"], select') : null;
    const enabled = (element: Element | null) => element && !element.matches(':disabled, [aria-disabled="true"]');
    const resume = () => audio.resume();
    const click = (event: MouseEvent) => { if (enabled(button(event.target))) { audio.resume(); audio.uiClick(); } };
    const hover = (event: PointerEvent) => {
      const element = button(event.target);
      if (enabled(element) && !(event.relatedTarget instanceof Node && element?.contains(event.relatedTarget))) audio.uiHover();
    };
    const focus = (event: FocusEvent) => { if (enabled(button(event.target))) audio.uiHover(); };
    const attach = () => audio.partAttach();
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
    document.addEventListener('click', click, true);
    document.addEventListener('pointerover', hover, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('wsp:part-attach', attach);
    return () => {
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
      document.removeEventListener('click', click, true);
      document.removeEventListener('pointerover', hover, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('wsp:part-attach', attach);
      audio.dispose(); shared = undefined;
    };
  }, []);
}
