import * as THREE from 'three';
import type { Body } from '../../sim/bodies/types';
import type { TrajectoryPatch } from '../../sim/orbit/api';
import type { Vec3 } from '../../util/vec3';
import type { MapMarkerInput, MapUpdate, MapApproach, MapPoint } from './mapTypes';
import type { MapFrame } from './MapFrame';
import { firstPlannedPatch, markerCaption, markerDetail, orbitMarkers, type OrbitMarker } from './orbitMarkers';
import { GLYPH_PX, LABEL_SHADOW, cssHex, glyphForKey, markerGlyphSvg, type MarkerGlyph } from './markerGlyphs';
import { coveredIndex, nudgeClear, overlapsAny } from './hudAvoid';
import { placeLabel, type LabelBox } from './presentation';
import { setPosition, setStyle } from './styleWriter';
import { patchColor } from './MapLines';

const EMPTY_MARKERS: MapMarkerInput[] = [];
const EMPTY_PATCHES: TrajectoryPatch[] = [];
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const TARGET_CSS = '#ff4fb8';
const IMPACT_CSS = '#ff5c5c';

/** A marker drawn this frame (pooled). */
interface ShownMarker {
  key: string; body: string; position: Vec3; caption: string; color: string; priority: number;
  orbit?: OrbitMarker; detail?: string; dotOnly?: boolean; time?: number; glyph: MarkerGlyph;
  /** Body placement time (encounter patches); undefined = now. */
  frameTime?: number;
}
interface MarkerElement {
  root: HTMLDivElement; dot: HTMLDivElement; text: HTMLDivElement; box: LabelBox; content: string; color: string; glyph: string;
  /** Thin line from a nudged glyph back to its true point, as last written (rounded to 0.01 rad / 1 px). */
  leader: HTMLDivElement; leaderA: number; leaderL: number;
  /** Caption sits left of the glyph (the right side runs under a HUD panel). */
  flipped: boolean;
  /** Caption placement box, re-measured only when its text changes. */
  caption: LabelBox; measured: string; lines: number;
}

const EMPTY_RECTS: LabelBox[] = [];
/** A marker within this many px of a HUD block counts as covered by it; a nudged marker stands this far clear. */
const HUD_COVER_PX = 6, HUD_CLEAR_PX = 10;
/** Owns event-marker pools, captions, pin state and closest-approach geometry. */
export class MapMarkers {
  private orbitMarks: OrbitMarker[] = [];
  private orbitMarksKey = '';
  private shown: ShownMarker[] = [];
  private shownCount = 0;
  private markerEls: MarkerElement[] = [];
  /** Per marker element: its caption won placement this frame. */
  private captioned: boolean[] = [];
  private markerScreen: { key: string; x: number; y: number }[] = [];
  private markerScreenCount = 0;
  private readonly nudgeAt = { x: 0, y: 0 };
  private pinned = new Set<string>();
  private approach: MapApproach | null = null;
  private approachLine: THREE.Line;
  private readonly markerCentre: MapPoint = { x: 0, y: 0 };
  private readonly scratch = new THREE.Vector3();
  private readonly scratchPoint: MapPoint = { x: 0, y: 0 };
  constructor(scene: THREE.Scene, private labels: HTMLElement, private bodies: Map<string, Body>, private frame: MapFrame) {
    const approachGeometry = new THREE.BufferGeometry();
    approachGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.approachLine = new THREE.Line(approachGeometry, new THREE.LineBasicMaterial({ color: 0xff4fb8, transparent: true, opacity: .7, depthTest: false }));
    this.approachLine.frustumCulled = false; this.approachLine.visible = false; this.approachLine.renderOrder = 13;
    scene.add(this.approachLine);
  }

  setApproach(approach: MapApproach | null) { this.approach = approach; }
  setWarmup(on: boolean) { this.approachLine.visible = on; }
  togglePin(key: string) { if (!this.pinned.delete(key)) this.pinned.add(key); }

  pick(x: number, y: number): string | null {
    for (let i = 0; i < this.markerScreenCount; i++) {
      const m = this.markerScreen[i];
      if (Math.hypot(m.x - x, m.y - y) < GLYPH_PX / 2 + 3) return m.key;
    }
    return null;
  }

  tooltip(key: string, time: number): string | null {
    for (let i = 0; i < this.shownCount; i++) if (this.shown[i].key === key) return `${this.markerDetailText(this.shown[i], time)}\n${this.pinned.has(key) ? 'Click to unpin' : 'Click to pin'}`;
    return null;
  }

  menu(key: string) {
    const m = this.shown.slice(0, this.shownCount).find(x => x.key === key);
    return m ? { key: m.key, label: m.orbit ? (m.orbit.kind === 'ap' ? 'Apoapsis' : m.orbit.kind === 'pe' ? 'Periapsis' : markerCaption(m.orbit, this.bodyName)) : m.key.startsWith('ca') ? 'Closest approach' : m.caption, time: m.time, pinned: this.pinned.has(m.key) } : null;
  }

  private bodyName = (id: string) => this.bodies.get(id)?.name ?? id;
  private bodyRadius = { radius: (id: string) => this.bodies.get(id)?.radius ?? 0, soi: (id: string) => this.bodies.get(id)?.soi ?? Infinity };

  private pushMarker(key: string, body: string, position: Vec3, caption: string, color: string, priority: number, glyph: MarkerGlyph, orbit?: OrbitMarker, detail?: string, dotOnly = false, time?: number) {
    const m = this.shown[this.shownCount] ??= { key: '', body: '', position, caption: '', color: '', priority: 0, glyph: 'dot' };
    m.key = key; m.body = body; m.position = position; m.caption = caption; m.color = color; m.priority = priority;
    m.orbit = orbit; m.detail = detail; m.dotOnly = dotOnly; m.time = time ?? orbit?.time; m.glyph = glyph; m.frameTime = undefined;
    this.shownCount++;
    return m;
  }

  private markerElement(i: number): MarkerElement {
    let el = this.markerEls[i];
    if (el) return el;
    const root = document.createElement('div'), dot = document.createElement('div'), text = document.createElement('div'), leader = document.createElement('div');
    Object.assign(root.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', display: 'none' });
    Object.assign(leader.style, { position: 'absolute', left: '0', top: '0', width: '1px', height: '1px', transformOrigin: '0 0', display: 'none', opacity: '.65' });
    Object.assign(dot.style, { position: 'absolute', left: `${-GLYPH_PX / 2}px`, top: `${-GLYPH_PX / 2}px`, width: `${GLYPH_PX}px`, height: `${GLYPH_PX}px`, lineHeight: '0' });
    Object.assign(text.style, { position: 'absolute', left: `${GLYPH_PX / 2 + 3}px`, top: '-9px', font: '600 12px system-ui, sans-serif', whiteSpace: 'pre', textShadow: LABEL_SHADOW, lineHeight: '17px', letterSpacing: '.02em' });
    root.appendChild(leader); root.appendChild(dot); root.appendChild(text);
    this.labels.appendChild(root);
    el = { root, dot, text, leader, leaderA: NaN, leaderL: -1, flipped: false, box: { x: 0, y: 0, width: 0, height: 17 }, content: '', color: '', glyph: '', caption: { x: 0, y: 0, width: 0, height: 0 }, measured: '', lines: 0 };
    this.markerEls[i] = el;
    return el;
  }

  private markerDetailText(m: ShownMarker, t: number) {
    return m.orbit ? markerDetail(m.orbit, t, this.bodyName) : m.detail ?? m.caption;
  }

  update(u: MapUpdate, patchVersion: number, labelBoxes: LabelBox[], labelCount: number, hudRects: LabelBox[] = EMPTY_RECTS, hudCount = 0, obstacles = hudCount) {
    const patches = u.vessel?.patches ?? EMPTY_PATCHES;
    const key = `${patchVersion}:${patches.length ? Math.floor(u.t) : 0}`;
    if (key !== this.orbitMarksKey) {
      this.orbitMarksKey = key;
      try { this.orbitMarks = orbitMarkers(patches, u.t, this.bodyRadius); } catch { this.orbitMarks = []; }
    }
    this.shownCount = 0;
    const planned = firstPlannedPatch(patches);
    for (const m of this.orbitMarks) {
      const apsis = m.kind === 'ap' || m.kind === 'pe';
      // Markers take the colour of the trajectory they sit on; an encounter takes the colour of the patch inside
      // the encountered body, so marker and arc read as one.
      const color = m.kind === 'impact' ? IMPACT_CSS : cssHex(patchColor(m.kind === 'encounter' ? m.patch + 1 : m.patch, planned));
      this.pushMarker(m.key, m.body, m.position, markerCaption(m, this.bodyName), color, apsis ? 1 : 2, m.kind, m).frameTime = this.frame.patchFrameTime(u, patches[m.patch]);
    }
    const markers = u.markers ?? EMPTY_MARKERS;
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i], key = m.key ?? `ext:${i}`;
      this.pushMarker(key, m.body, m.position, m.label, m.color, 1, glyphForKey(key), undefined, m.detail, false, m.time);
    }
    const a = this.approach && this.bodies.has(this.approach.body) ? this.approach : null;
    if (a) {
      this.pushMarker('ca', a.body, a.positionA, a.label, TARGET_CSS, 2, 'approach', undefined, a.detail, false, a.time);
      this.pushMarker('ca:target', a.body, a.positionB, '', TARGET_CSS, 0, 'dot', undefined, a.detail, true, a.time);
    }
    this.approachLine.visible = !!a;
    if (a) {
      const pos = this.approachLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      this.frame.scenePosition(a.positionA, a.body, u, this.scratch); pos.setXYZ(0, this.scratch.x, this.scratch.y, this.scratch.z);
      this.frame.scenePosition(a.positionB, a.body, u, this.scratch); pos.setXYZ(1, this.scratch.x, this.scratch.y, this.scratch.z);
      pos.needsUpdate = true;
    }
    // Dots for every marker; captions in priority order (pinned first), decluttered against body labels.
    this.markerScreenCount = 0;
    for (let i = 0; i < this.shownCount; i++) {
      const m = this.shown[i], el = this.markerElement(i);
      const s = this.frame.toScreen(this.frame.scenePosition(m.position, m.body, u, this.scratch, m.frameTime ?? u.t), u, this.scratchPoint);
      let on = s.x > -20 && s.y > -20 && s.x < u.viewport.width + 20 && s.y < u.viewport.height + 20;
      // Apsides of an orbit that is only a few pixels across are noise piled on the body icon: hide them until
      // the orbit is large enough to tell apart (pinned markers stay).
      // The focused body's own flyby periapsis always shows (it is what an encounter is planned for).
      if (on && (m.glyph === 'ap' || m.glyph === 'pe') && !this.pinned.has(m.key) && !(m.glyph === 'pe' && m.body === u.focusId && m.body !== patches[0]?.orbit.body)) {
        const sx = s.x, sy = s.y, c = this.frame.toScreen(this.frame.scenePosition(ZERO, m.body, u, this.scratch, m.frameTime ?? u.t), u, this.markerCentre);
        on = !(Math.hypot(c.x - sx, c.y - sy) < 16);
        s.x = sx; s.y = sy;
      }
      setStyle(el.root, 'display', on ? 'block' : 'none');
      el.box.x = NaN;
      if (!on) continue;
      // A marker under a HUD panel moves to the nearest clear spot, joined to its true point by a thin leader line;
      // the spot is reserved so a second covered marker does not land on top of it.
      let px = s.x, py = s.y, nudged = false;
      if (hudCount && coveredIndex(hudRects, hudCount, px, py, HUD_COVER_PX) >= 0
        && nudgeClear(hudRects, obstacles, px, py, u.viewport.width, u.viewport.height, HUD_CLEAR_PX, this.nudgeAt)) {
        px = this.nudgeAt.x; py = this.nudgeAt.y; nudged = true;
        const spot = hudRects[obstacles++] ??= { x: 0, y: 0, width: GLYPH_PX, height: GLYPH_PX };
        spot.x = px - GLYPH_PX / 2; spot.y = py - GLYPH_PX / 2; spot.width = GLYPH_PX; spot.height = GLYPH_PX;
      }
      setPosition(el.root, px, py);
      if (el.color !== m.color || el.glyph !== m.glyph) {
        el.color = m.color; el.glyph = m.glyph;
        el.dot.innerHTML = markerGlyphSvg(m.glyph, m.color); el.text.style.color = m.color; el.leader.style.background = m.color;
      }
      setStyle(el.leader, 'display', nudged ? 'block' : 'none');
      if (nudged) {
        const dx = s.x - px, dy = s.y - py, a = Math.round(Math.atan2(dy, dx) * 100), len = Math.round(Math.hypot(dx, dy));
        if (a !== el.leaderA || len !== el.leaderL) { el.leaderA = a; el.leaderL = len; el.leader.style.transform = `rotate(${a / 100}rad) scaleX(${len})`; }
      }
      el.box.x = px; el.box.y = py;
      const hit = this.markerScreen[this.markerScreenCount++] ??= { key: '', x: 0, y: 0 };
      hit.key = m.key; hit.x = px; hit.y = py;
    }
    for (let i = this.shownCount; i < this.markerEls.length; i++) setStyle(this.markerEls[i].root, 'display', 'none');
    // Captions: shown below only if they win placement this frame.
    const captioned = this.captioned;
    captioned.fill(false);
    for (let pass = 3; pass >= 0; pass--) for (let i = 0; i < this.shownCount; i++) {
      const m = this.shown[i], el = this.markerEls[i], pinned = this.pinned.has(m.key);
      if (Number.isNaN(el.box.x) || (pinned ? 3 : m.priority) !== pass || m.dotOnly && !pinned) continue;
      const content = pinned ? this.markerDetailText(m, u.t) : m.caption;
      if (!content) continue;
      const box = el.caption;
      if (el.measured !== content) {
        el.measured = content;
        let lines = 0, longest = 0;
        for (let start = 0; start <= content.length; lines++) {
          let end = content.indexOf('\n', start);
          if (end < 0) end = content.length;
          longest = Math.max(longest, end - start);
          start = end + 1;
        }
        box.width = longest * 7 + 12; el.lines = lines;
      }
      box.x = el.box.x + GLYPH_PX / 2 + 3; box.y = el.box.y - 9; box.height = el.lines * 17 + (pinned ? 6 : 0);
      // A caption that would run under a HUD panel flips to the glyph's other side.
      const flip = hudCount > 0 && overlapsAny(box, hudRects, hudCount, 2);
      if (flip) box.x = el.box.x - GLYPH_PX / 2 - 3 - box.width;
      if (!pinned && (!placeLabel(box, labelBoxes, labelCount) || (flip && overlapsAny(box, hudRects, hudCount, 2)))) continue;
      labelBoxes[labelCount++] = box;
      captioned[i] = true;
      if (el.flipped !== flip) {
        el.flipped = flip;
        Object.assign(el.text.style, flip ? { left: 'auto', right: `${GLYPH_PX / 2 + 3}px`, textAlign: 'right' } : { left: `${GLYPH_PX / 2 + 3}px`, right: 'auto', textAlign: 'left' });
      }
      if (el.content !== content) { el.content = content; el.text.textContent = content; }
      setStyle(el.text, 'background', pinned ? '#0a1525dd' : 'none');
      setStyle(el.text, 'border', pinned ? `1px solid ${m.color}55` : 'none');
      setStyle(el.text, 'borderRadius', pinned ? '6px' : '0');
      setStyle(el.text, 'padding', pinned ? '3px 7px' : '0');
    }
    for (let i = 0; i < this.markerEls.length; i++) setStyle(this.markerEls[i].text, 'display', i < this.shownCount && captioned[i] ? 'block' : 'none');
    return labelCount;
  }

}
