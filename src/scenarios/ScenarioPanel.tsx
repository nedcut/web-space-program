import { scheduleFlightEnd } from '../flight/lossPresentation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TOUR_MOONS } from './evaluation';
import { endScenario, startScenario, useScenarioRun } from './runtime';
import './scenarios.css';
export function ScenarioPanel() {
  const run = useScenarioRun();
  const [collapsed, setCollapsed] = useState(false);
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    if (run?.epoch === undefined) return;
    setCollapsed(false);
    // The flight HUD mounts after its loading boundary, and is replaced on Retry.
    let current: Element | null = null;
    const findHost = () => {
      if (current?.isConnected) return;
      current = document.querySelector('.app-stack');
      setHost(current);
    };
    findHost();
    const observer = new MutationObserver(findHost);
    observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [run?.epoch]);
  const [failureReady,setFailureReady] = useState(false);
  const failed = !!run?.result && !run.result.success;
  useEffect(() => {
    setFailureReady(false);
    if (failed) return scheduleFlightEnd(() => setFailureReady(true));
  }, [failed,run?.epoch]);
  if (!run || !host || (failed && !failureReady)) return null;
  const { state, result, scenario } = run;
  const observation = state.previous;
  const precision = observation?.precision;
  const minimized = collapsed && !result;
  return createPortal(<aside className={`panel scenario-flight ${result ? 'scenario-debrief' : ''} ${minimized ? 'scenario-collapsed' : ''}`} aria-label={result ? 'Mission debrief' : 'Mission objectives'} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); }}>
    <div className="scenario-heading"><div className="scenario-flight-head"><div className="label">Missions · {scenario.region}</div>{!result && <button className="scenario-toggle" aria-expanded={!minimized} aria-label={minimized ? 'Expand mission card' : 'Minimize mission card'} title={minimized ? 'Expand' : 'Minimize'} onClick={e => { e.currentTarget.blur(); setCollapsed(c => !c); }}>{minimized ? '+' : '–'}</button>}</div><h2>{scenario.title}</h2></div>
    {result ? <><h3 aria-live="polite">{result.success ? `${result.medal.toUpperCase()} · ${result.score.toLocaleString()} points` : 'Mission ended'}</h3><p>{state.reason}</p>{run.personalBest && <p className="medal-gold">New personal best saved.</p>}<p>Flight time: {result.elapsed.toFixed(1)} s · Δv used: {result.dv.toFixed(2)} m/s</p>{result.landingSpeed !== null && <p>Touchdown: {result.landingSpeed.toFixed(2)} m/s</p>}{result.precision !== null && <p>Target miss: {result.precision.toFixed(0)} m</p>}{result.scienceBonus && <p>Deep plume sample: +5,000 science bonus points.</p>}</> : <>{!minimized && <><p>{scenario.objective}</p><p className="scenario-muted">{scenario.hint}</p></>}<p>Time {state.elapsed.toFixed(0)} s · Δv {state.dv.toFixed(1)} m/s</p>{run.setup.targetName && <p>{run.setup.targetName}<br />Target miss: {Number.isFinite(precision) ? precision!.toFixed(0) : '—'} m</p>}{scenario.id === 'grand-tour' && <p>{TOUR_MOONS.map(m => `${state.visited.includes(m) ? '✓' : '○'} ${m}`).join(' · ')}</p>}{scenario.id === 'plume-dive' && <p>{state.plume ? '✓ Plume sampled — climb above 15 km' : '○ South polar sampling pass'}{state.scienceBonus && ' · Deep sample bonus'}</p>}{scenario.id === 'ring-skimmer' && <p>{state.crossed ? `✓ Gap crossed · ${state.precision.toFixed(0)} m from center` : '○ Cross north → south through the gap'}</p>}{scenario.id === 'suicide-burn' && <p>Hover allowance: {Math.max(0, 2 - state.hover).toFixed(1)} s</p>}{scenario.id === 'jupiter-assist' && <p>{state.jupiterPeriapsis ? '✓' : '○'} Jupiter flyby · {state.leftJupiter ? '✓' : '○'} SOI exit · ○ Saturn arrival</p>}</>}
    {!minimized && <div className="scenario-actions"><button className="btn small primary" onClick={e => { e.currentTarget.blur(); startScenario(scenario.id); }}>Retry</button><button className="btn small" onClick={endScenario}>Scenarios</button></div>}
  </aside>, host);
}
