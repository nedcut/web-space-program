import { bindingLabel, getBindings, subscribeBindings } from '../../input/bindings';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Astronaut } from '../../sim/crew/crew';
import type { Telemetry, HudCallbacks } from './Hud';

export function Portrait({ person, size = 42 }: { person: Astronaut; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!.getContext('2d')!;
    c.clearRect(0,0,64,64);
    c.fillStyle = '#192c3f'; c.fillRect(0,0,64,64);
    c.fillStyle = '#ea752e'; c.beginPath(); c.ellipse(32,64,25,23,0,0,Math.PI*2); c.fill();
    c.fillStyle = '#f0f0e9'; c.beginPath(); c.ellipse(32,29,25,27,0,0,Math.PI*2); c.fill();
    c.fillStyle = '#404348'; c.beginPath(); c.ellipse(32,29,20,21,0,0,Math.PI*2); c.fill();
    const tones = ['#efc8a5','#d3a27c','#b47c55','#865138','#5c392c'];
    c.fillStyle = tones[person.portrait % tones.length]; c.beginPath(); c.ellipse(32,30,14,18,0,0,Math.PI*2); c.fill();
    c.fillStyle = '#292020'; c.beginPath(); c.ellipse(32,16,14,7,0,Math.PI,Math.PI*2); c.fill();
    c.fillRect(24,27,3,3); c.fillRect(37,27,3,3);
    c.strokeStyle = '#613d30'; c.lineWidth = 2; c.beginPath(); c.arc(32,35,6,0.2,Math.PI-0.2); c.stroke();
    c.strokeStyle = '#ffe2a055'; c.lineWidth = 3; c.beginPath(); c.ellipse(32,29,20,21,0,0,Math.PI*2); c.stroke();
    c.fillStyle = '#ffffff66'; c.fillRect(17,16,4,13);
  }, [person.portrait]);
  return <canvas ref={ref} width={64} height={64} style={{ width: size, height: size, borderRadius: 8 }} aria-label={`Portrait of ${person.name}`} />;
}

export function CrewPanel({ t, cb }: { t: Telemetry; cb: HudCallbacks }) {
  const bindings = useSyncExternalStore(subscribeBindings, getBindings);
  const key = (action: Parameters<typeof bindingLabel>[0]) => bindingLabel(action, bindings);
  return <div className="panel" style={{ padding: 10, pointerEvents: 'auto', maxHeight: 240, overflowY: 'auto', flexShrink: 0 }}>
    <div className="label" style={{ marginBottom: 7 }}>{t.eva ? 'EXTRAVEHICULAR ACTIVITY' : 'CREW'}{t.noControl && <span style={{ color: 'var(--warn)' }}> · No control</span>}</div>
    {t.crew.map(person => <div key={person.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
      <Portrait person={person} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12 }}>{person.name}</div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)' }} title="Personality stats — flavour only">Courage {person.courage} · Skill {person.skill}</div>
        {!t.eva && <button className="btn small" title={`Leave the cabin (${key('eva')})`} onClick={() => cb.onEva(person.id)} style={{ marginTop: 4 }}>Go EVA · {key('eva')}</button>}
      </div>
    </div>)}
    {!t.crew.length && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t.noControl ? 'An astronaut or probe core is required.' : 'Uncrewed · remote control'}</div>}
    {t.eva && <>
      <div className="mono" style={{ fontSize: 11, marginBottom: 6 }}>Jetpack {t.eva.jetpack ? 'on' : 'off'} ({key('toggleRcs')}) · {t.eva.fuel.toFixed(2)} / 5 kg</div>
      <div style={{ display: 'flex', gap: 5 }}>
        <button className="btn small" disabled={!t.eva.canBoard} title={t.eva.boardHint ?? `Board at a free hatch within 3 m, below 3 m/s (${key('board')})`} onClick={cb.onBoard}>Board · {key('board')}</button>
        <button className="btn small" disabled={!t.eva.landed} title={`Plant a flag on solid ground (${key('plantFlag')})`} onClick={cb.onPlantFlag}>Flag · {key('plantFlag')}</button>
      </div>
      {t.eva.boardHint && <div role="status" style={{ fontSize: 10, marginTop: 5, color: 'var(--warn)' }}>{t.eva.boardHint}</div>}
      <div style={{ fontSize: 10, marginTop: 7, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {key('evaForward')}/{key('evaLeft')}/{key('evaBack')}/{key('evaRight')} move (camera relative) · {key('evaRun')} run · {key('evaJump')} jump<br />{key('toggleRcs')} jetpack · {key('evaUp')}/{key('evaDown')} up / down while it is on<br />Drag to look around · Board within 3 m of a hatch
      </div>
    </>}
  </div>;
}
