import { useEffect, useReducer } from 'react';
import type { MapView } from '../../render/map/MapView';
import { BIOME_TARGET_CSS } from '../../render/map/biomeStyle';
import type { BiomeObjective } from '../../game/biomeObjectives';

/**
 * Map layer switches (biomes, cities), the biome legend of the body in view and the biomes active objectives ask
 * for. Clicking an objective or a legend row turns the camera to that biome (`onShow`, host-specific focus).
 */
export function MapLayers({ map, bodyId, bodyName, objectives, onShow }: {
  map: MapView; bodyId: string | undefined; bodyName: (id: string) => string; objectives: () => readonly BiomeObjective[];
  onShow(body: string, biome: string): void;
}) {
  const [, bump] = useReducer((n: number) => (n + 1) % 1e6, 0);
  // Biome maps arrive from a worker and contracts complete in flight: refresh when the overlay's version moves,
  // and every two seconds for objectives.
  useEffect(() => {
    let seen = map.surface.version, ticks = 0;
    const id = window.setInterval(() => { if (map.surface.version !== seen || ++ticks % 5 === 0) { seen = map.surface.version; bump(); } }, 400);
    return () => window.clearInterval(id);
  }, [map]);
  const biomes = map.biomeOverlayEnabled, cities = map.cityLabelsEnabled;
  const legend = biomes && bodyId ? map.biomeLegend(bodyId) : null;
  return <div className="map-layers" onPointerDown={e => e.stopPropagation()}>
    <div className="map-layers-toggles" role="group" aria-label="Map layers">
      <button className={`btn ghost small${biomes ? ' on' : ''}`} aria-pressed={biomes} title="Colour the surface by science biome"
        onClick={() => { map.setBiomeOverlay(!biomes); bump(); }}>Biomes</button>
      <button className={`btn ghost small${cities ? ' on' : ''}`} aria-pressed={cities} title="Label Earth's major cities as you zoom in"
        onClick={() => { map.setCityLabels(!cities); bump(); }}>Cities</button>
    </div>
    {objectives().map(o => <button key={`${o.body}:${o.biome}`} className="btn ghost small map-objective" title={`${o.title}\nShow ${o.biome} on ${bodyName(o.body)}`}
      onClick={() => onShow(o.body, o.biome)}>
      <span className="map-swatch target" style={{ borderColor: BIOME_TARGET_CSS }} />
      <span>{o.biome} · {bodyName(o.body)}</span><span className="map-show">Show</span>
    </button>)}
    {biomes && bodyId && (legend
      ? <div className="map-legend" aria-label={`${bodyName(bodyId)} biomes`}>{legend.map(e =>
        <button key={e.name} className="btn ghost small" title={`Show ${e.name}`} onClick={() => onShow(bodyId, e.name)}>
          <span className="map-swatch" style={{ background: e.color, borderColor: e.target ? BIOME_TARGET_CSS : 'transparent' }} />{e.name}
        </button>)}</div>
      : null)}
    {biomes && bodyId && legend && map.surface.biomeMap(bodyId)?.smoothed && <span className="map-layers-note">Colours show each area's main biome; hover for the exact one.</span>}
    {biomes && bodyId && !legend && (<span className="map-layers-note">{map.surface.mapsBody(bodyId) ? 'Mapping biomes…' : `${bodyName(bodyId)} has a single biome`}</span>)}
  </div>;
}
