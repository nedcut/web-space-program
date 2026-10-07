import { useState } from 'react';
import type { World } from '../../game/world';
import type { MapView } from '../../render/map/MapView';
import { totalResource } from '../../sim/vessel/resources';

/** `act` routes drill/converter toggles through the authoritative command path (multiplayer-safe). */
export function ResourcePanel({ world, map, mapMode, paused, act }: { world: World; map: MapView; mapMode: boolean; paused: boolean; act?: (uid: number, action: 'drill.toggle' | 'converter.toggle') => void }) {
  const overlay = map.resourceOverlayEnabled;
  const [, refresh] = useState(0);
  const wv = world.active;
  if (!wv) return null;
  const v = wv.state;
  const parts = v.parts.filter(p => p.def.modules.some(m => ['drill', 'converter', 'surfaceScanner', 'surveyScanner'].includes(m.type)));
  if (!parts.length && !mapMode) return null;
  const disabled = paused || !world.canControl(v);
  return <div className="panel" style={{ padding: 10, pointerEvents: 'auto', maxHeight: 320, overflowY: 'auto', flexShrink: 0 }}>
    <div className="label">Surface resources</div>
    <>
      {mapMode && <><button title="Toggle surveyed resource concentrations on the map" className="btn small" onClick={() => {
        map.setResourceOverlay(world.surveyedBodies, !overlay); refresh(n => n + 1);
      }}>{overlay ? 'Hide' : 'Show'} regolith overlay</button><div style={{ fontSize: 11 }}>Surveyed bodies only · blue 0% → gold 100%</div></>}
      <div style={{ fontSize: 12, margin: '8px 0' }}>Regolith: {totalResource(v, 'regolith').toFixed(1)} L</div>
      {parts.map(p => <div key={p.uid} style={{ fontSize: 12, marginTop: 8 }}>
        <strong>{p.def.name}</strong>
        {p.def.modules.some(m => m.type === 'surfaceScanner') && <div>{v.situation === 'landed' ? `Local concentration: ${(world.localConcentration() * 100).toFixed(1)}%` : 'Land to read local concentration'}</div>}
        {p.def.modules.some(m => m.type === 'drill') && <div><button title="Deploy or retract drill; extraction requires solid ground, charge and tank space" className="btn small" disabled={disabled} onClick={() => { if (act) act(p.uid, 'drill.toggle'); else p.drillDeployed = !p.drillDeployed; refresh(n => n + 1); }}>{p.drillDeployed ? 'Retract drill' : 'Deploy drill'}</button><div>{v.situation !== 'landed' ? 'Requires solid ground' : (p.drillDeploy ?? 0) < 1 ? 'Drill stowed / deploying' : 'Extracting when charge and tank space permit'}</div></div>}
        {p.def.modules.some(m => m.type === 'converter') && <div>
          <select title="Choose the resource produced by this converter" aria-label="Converter recipe" disabled={disabled} value={p.converterRecipe ?? 'kerolox'} onChange={e => { p.converterRecipe = e.target.value as 'kerolox' | 'monopropellant'; refresh(n => n + 1); }}>
            <option value="kerolox">Fuel + oxidizer</option><option value="monopropellant">Monopropellant</option>
          </select>
          <button title="Convert regolith using the selected recipe; requires power and storage" className="btn small" disabled={disabled} onClick={() => { if (act) act(p.uid, 'converter.toggle'); else p.converterRunning = !p.converterRunning; refresh(n => n + 1); }}>{p.converterRunning ? 'Stop converter' : 'Start converter'}</button>
        </div>}
        {p.processTemperature !== undefined && <div>Process core: {p.processTemperature.toFixed(0)} K</div>}
        {p.def.modules.some(m => m.type === 'surveyScanner') && <div><button title="Survey from a polar orbit, above terrain and atmosphere" className="btn small" disabled={disabled || world.surveyedBodies.includes(wv.body)} onClick={() => {
          if (world.surveyBody()) { world.message('Resource field surveyed'); if (overlay) map.setResourceOverlay(world.surveyedBodies); }
          else world.message('Survey requires a bound polar orbit (80–100°), clear of terrain and atmosphere', 'warn');
          refresh(n => n + 1);
        }}>{world.surveyedBodies.includes(wv.body) ? 'Body surveyed' : 'Survey resource field'}</button></div>}
      </div>)}
    </>
  </div>;
}
