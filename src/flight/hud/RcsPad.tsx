import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type KeyboardEvent } from 'react';
import { bindingLabel, getBindings, subscribeBindings } from '../../input/bindings';
import { TRANSLATION_CONTROLS, type TranslationAction } from '../../input/translation';
import type { FlightInput } from '../input';
import './rcsPad.css';

export function RcsPad({ input, rcsOn, precision, enabled, onToggleRcs }: {
  input: FlightInput; rcsOn: boolean; precision: boolean; enabled: boolean; onToggleRcs(): void;
}) {
  const bindings = useSyncExternalStore(subscribeBindings, getBindings);
  const held = useSyncExternalStore(input.subscribeTranslation, input.translationSnapshot);
  const [offHint, setOffHint] = useState(false);
  useEffect(() => () => input.releaseTranslation(), [input]);
  const setHeld = useCallback((action: TranslationAction, down: boolean) => {
    if (down) setOffHint(true);
    input.setTranslation(action, down);
  }, [input]);
  return <div className="rcs-pad">
    <div className="rcs-switches">
      <button type="button" className={`btn small ${rcsOn ? 'on' : ''}`} aria-pressed={rcsOn} disabled={!enabled}
        onClick={onToggleRcs} title={`Reaction control thrusters (${bindingLabel('toggleRcs', bindings)})`}>RCS {rcsOn ? 'ON' : 'OFF'} <kbd>{bindingLabel('toggleRcs', bindings)}</kbd></button>
      <button type="button" className={`btn small ${precision ? 'on' : ''}`} aria-pressed={precision} disabled={!enabled}
        onClick={() => { input.precision = !input.precision; }} title={`Fine control: 35% thrust (${bindingLabel('precision', bindings)})`}>FINE {precision ? 'ON' : 'OFF'} <kbd>{bindingLabel('precision', bindings)}</kbd></button>
    </div>
    <p className="rcs-help">Hold to translate · craft-relative axes</p>
    <div className="rcs-controls">
      <span className="rcs-centre" aria-hidden>✛</span>
      {TRANSLATION_CONTROLS.map((c, i) => <TranslationButton key={c.action} action={c.action} label={c.label} arrow={c.arrow} place={c.place}
        binding={bindingLabel(c.action, bindings)} held={!!(held & (1 << i))} enabled={enabled} setHeld={setHeld} />)}
    </div>
    <p className="rcs-help rcs-status" role="status">{!enabled ? 'Flight controls unavailable.' : !rcsOn ? offHint ? 'No translation: RCS is OFF. Turn RCS on above.' : 'RCS is OFF. Turn it on to translate.' : precision ? 'Fine control · 35% thrust' : 'Full translation thrust'}</p>
  </div>;
}

function TranslationButton({ action, label, arrow, place, binding, held, enabled, setHeld }: {
  action: TranslationAction; label: string; arrow: string; place: string; binding: string; held: boolean; enabled: boolean;
  setHeld(action: TranslationAction, held: boolean): void;
}) {
  const pointer = useRef<number | null>(null);
  const keyHeld = useRef(false);
  const release = useCallback(() => { pointer.current = null; keyHeld.current = false; setHeld(action, false); }, [action, setHeld]);
  useEffect(() => {
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('blur', release); release(); };
  }, [release]);
  useEffect(() => { if (!enabled) release(); }, [enabled, release]);
  const up = (e: PointerEvent<HTMLButtonElement>) => { if (e.pointerId === pointer.current) { pointer.current = null; if (!keyHeld.current) setHeld(action, false); } };
  const key = (e: KeyboardEvent<HTMLButtonElement>, down: boolean) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    keyHeld.current = down;
    setHeld(action, down || pointer.current !== null);
  };
  return <button type="button" className={`rcs-direction ${place}${held ? ' held' : ''}`} aria-label={`Translate ${label.toLowerCase()}`} aria-pressed={held}
    disabled={!enabled} title={`Hold to translate ${label.toLowerCase()} (${binding})`}
    onPointerDown={e => {
      if (e.button !== 0 || pointer.current !== null) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      pointer.current = e.pointerId;
      setHeld(action, true);
    }} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
    onKeyDown={e => key(e, true)} onKeyUp={e => key(e, false)} onBlur={release}>
    <span aria-hidden>{arrow}</span><span>{label}</span><kbd>{binding}</kbd>
  </button>;
}
