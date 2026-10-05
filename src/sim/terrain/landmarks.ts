import type { BodyDef } from '../bodies/types';
import type { Terrain } from './api';
import { latLonToUnit } from './geo';
import { scale, length, sub, type Vec3 } from '../../util/vec3';

export interface Landmark {
  id: string; body: string; name: string; lat: number; lon: number;
  kind: 'probe' | 'arch' | 'cairn' | 'airfield'; description: string;
}
/** Original expedition history and natural formations, in body-fixed degrees. */
export const LANDMARKS: readonly Landmark[] = [
  { id: 'wayfarer', body: 'moon', name: 'Wayfarer-3', lat: -43.3, lon: -11.2, kind: 'probe', description: 'A folded antenna and three landing feet mark the last signal from the fictional Wayfarer survey program.' },
  { id: 'bell-rim', body: 'moon', name: 'Bell Rim', lat: 9.6, lon: -20.1, kind: 'cairn', description: 'A splintered central peak overlooks a broad terraced impact basin.' },
  { id: 'thread-arch', body: 'mars', name: 'Threadneedle Arch', lat: -9, lon: -48, kind: 'arch', description: 'Wind has undercut an ancient sediment bed, leaving a double-footed stone bridge.' },
  { id: 'polar-pages', body: 'mars', name: 'Polar Pages', lat: 82, lon: 20, kind: 'cairn', description: 'Alternating ice and dust layers preserve a record of changing seasons.' },
  { id: 'sable-shore', body: 'titan', name: 'Sable Shore', lat: 68, lon: 40, kind: 'arch', description: 'A frost-cemented arch faces the dark Sable Sea.' },
  { id: 'lantern-station', body: 'titan', name: 'Lantern Surveyor', lat: 72, lon: 115, kind: 'probe', description: 'An abandoned weather mast from the fictional Lantern balloon campaign.' },
  { id: 'ember-step', body: 'io', name: 'Ember Step', lat: 18, lon: 30, kind: 'cairn', description: 'Sulphur shelves surround a restless volcanic depression.' },
  { id: 'rafts', body: 'europa', name: 'Driftwood Rafts', lat: -20, lon: 65, kind: 'cairn', description: 'Tilted plates of old ice have frozen together in a field of fractured terrain.' },
  { id: 'blue-gate', body: 'enceladus', name: 'Blue Gate', lat: -78, lon: 45, kind: 'arch', description: 'A blue ice bridge straddles the young south-polar terrain.' },
  { id: 'fold', body: 'mercury', name: 'Last Fold', lat: 22, lon: -35, kind: 'cairn', description: 'A buckled ridge records the contraction of a cooling world.' },
  { id: 'reed-field', body: 'earth', name: 'Reed Airfield', lat: 29.5, lon: -82, kind: 'airfield', description: 'A small inland survey strip with a painted threshold and navigation mast.' },
  { id: 'salt-field', body: 'earth', name: 'Saltwind Airfield', lat: 27, lon: -80.8, kind: 'airfield', description: 'A coastal strip used by the fictional Saltwind atmospheric survey.' },
];
export function landmarkPosition(body: BodyDef, terrain: Terrain, landmark: Landmark): Vec3 {
  const d = latLonToUnit(landmark.lat, landmark.lon);
  return scale(d, body.radius + terrain.heightAt(d.x, d.y, d.z));
}
export function nearbyLandmarks(body: BodyDef, terrain: Terrain, position: Vec3, known: readonly string[]): Landmark[] {
  return LANDMARKS.filter(l => l.body === body.id && !known.includes(l.id) && length(sub(position, landmarkPosition(body, terrain, l))) <= 2000);
}
