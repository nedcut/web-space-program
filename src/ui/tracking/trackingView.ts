import { MapView, type ExtraOrbit, type MapPick, type MapPoint } from '../../render/map/MapView';
import { formatDistance } from '../../util/format';
import { RenderPipeline, getQuality } from '../../render/core';
import { game, applyCommsSettings } from '../../game/store';
import type { World } from '../../game/world';
import { RAILS_WARP } from '../../game/timewarp';
import { neutralInput } from '../../sim/vessel';
import { requestBiomeMap } from '../../game/biomeMaps';
import { biomeObjectives } from '../../game/biomeObjectives';
import { qConj, qRotate } from '../../util/quat';
import { length, scale, sub } from '../../util/vec3';

export type TrackingFocus = { kind: 'body' | 'vessel'; id: string };

/** Imperative simulation/render loop; React only receives low-frequency UI refreshes. */
export class TrackingView {
  private pipeline: RenderPipeline;
  private map: MapView;
  private frame = 0;
  private resize: ResizeObserver;
  private detach: () => void;
  private focus: TrackingFocus;
  private last = performance.now();
  private lastUi = 0;
  private lastOrbits = -Infinity;
  private fleet: ExtraOrbit[] = [];
  private width = 1;
  private height = 1;

  constructor(private host: HTMLElement, readonly world: World, private refresh: () => void,
    private focused: (focus: TrackingFocus) => void, private menu: (pick: MapPick | null, at?: MapPoint) => void = () => {}) {
    this.pipeline = new RenderPipeline({ quality: getQuality(game.get().settings.quality) });
    this.pipeline.setMapMode(true); // the tracking station is all map: full device resolution
    const canvas = this.pipeline.renderer.domElement;
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
    host.appendChild(canvas);
    this.map = new MapView(world.universe.bodies, world.universe.ephem, host, getQuality(game.get().settings.quality), world.universe);
    this.map.setBiomeSource(requestBiomeMap);
    this.focus = { kind: 'body', id: world.universe.sunId };
    this.setFocus(this.focus);
    this.detach = this.map.attachControls(canvas, () => this.focus.kind === 'body' ? world.universe.body(this.focus.id).radius * 1.2 : 1500);
    // Same gestures as the flight map: double-click focuses, click / right-click opens the object menu.
    this.map.handlers = {
      focus: (pick) => { this.menu(null); this.setFocus(pick); },
      objectMenu: (pick, at) => this.menu(pick, at),
      emptyClick: () => this.menu(null),
      describe: (pick) => this.describe(pick),
    };
    this.resize = new ResizeObserver(() => {
      this.width = Math.max(1, host.clientWidth);
      this.height = Math.max(1, host.clientHeight);
      this.pipeline.setSize(this.width, this.height);
    });
    this.resize.observe(host);
    world.warp = { mode: 'rails', index: 0 };
    this.frame = requestAnimationFrame(this.animate);
  }

  setFocus(focus: TrackingFocus) {
    this.focus = focus;
    const u = this.world.universe;
    if (focus.kind === 'body') {
      if (!u.bodies.has(focus.id)) this.world.setTarget(focus.id);
      this.map.setTarget(u.activatedAsteroids.has(focus.id) ? focus : null);
      const b = u.body(focus.id);
      this.map.distance = b.kind === 'star'
        ? Math.max(...b.children.map((id) => u.body(id).orbit?.a ?? 0)) * 2.8
        : Math.max(b.radius * 7, ...b.children.map((id) => (u.body(id).orbit?.a ?? 0) * 3));
    } else {
      const v = this.world.vessels.get(focus.id);
      if (v) this.map.distance = u.body(v.body).radius * 5;
    }
    this.focused(focus);
  }

  get mapView(): MapView { return this.map; }

  private pendingBiome: { body: string; biome: string } | null = null;

  /** Focus a body and look down on its region of `biome` nearest the active vessel (once the map is built). */
  showBiome(body: string, biome: string) {
    this.setFocus({ kind: 'body', id: body });
    this.pendingBiome = { body, biome };
  }

  private lookAtPendingBiome() {
    const p = this.pendingBiome, w = this.world;
    if (!p) return;
    if (this.focus.kind !== 'body' || this.focus.id !== p.body) { this.pendingBiome = null; return; }
    const v = w.active?.body === p.body ? w.active : undefined;
    const rel = v ? qRotate(qConj(w.universe.ephem.bodyRotation(p.body, w.ut)), sub(v.state.position, w.universe.ephem.getBodyState(p.body, w.ut).position)) : undefined;
    const anchor = this.map.biomeAnchor(p.body, p.biome, rel && length(rel) > 0 ? scale(rel, 1 / length(rel)) : undefined);
    if (!anchor) return;
    this.pendingBiome = null;
    this.map.lookAtSurface(p.body, anchor, w.ut);
  }

  private describe(pick: MapPick): string | null {
    if (pick.kind !== 'vessel') return null;
    const v = this.world.vessels.get(pick.id);
    if (!v) return null;
    const lines = [v.state.name, `${this.world.universe.body(v.body).name} · ${v.mode === 'prelaunch' ? 'prelaunch' : v.state.situation}`];
    try {
      if (v.state.situation === 'flying' && v.mode !== 'prelaunch') {
        const o = this.world.orbitSummary(v);
        lines.push(`Ap ${o.orbit.e < 1 ? formatDistance(o.ap) : 'escape'} · Pe ${formatDistance(o.pe)}`);
      }
    } catch { /* degenerate orbit */ }
    return lines.join('\n');
  }

  private animate = (now: number) => {
    const cap = game.get().settings.frameRateCap;
    if (cap && now - this.last < 1000 / cap - .5) { this.frame = requestAnimationFrame(this.animate); return; }
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    const world = this.world;
    applyCommsSettings(world);
    if (world.active) world.tick(dt, neutralInput());
    else world.advanceRailsTo(world.ut + dt * RAILS_WARP[world.warp.index]);
    if (this.focus.kind === 'vessel' && !world.vessels.has(this.focus.id)) this.setFocus({ kind: 'body', id: world.universe.sunId });
    if (now - this.lastOrbits > 500) {
      this.fleet = [...world.vessels.values()].map((v) => ({
        id: v.state.id, position: v.state.position,
        orbit: !world.preciseGravity && v.state.situation === 'flying' && v.mode !== 'prelaunch' ? world.orbitOf(v) : undefined,
      }));
      this.lastOrbits = now;
      this.map.setBiomeTargets(biomeObjectives(world.progression));
    }
    // Refresh positions each frame without rebuilding the conics.
    for (let i = this.fleet.length-1; i >= 0; i--) if (!world.vessels.has(this.fleet[i].id)) this.fleet.splice(i,1);
    for (const item of this.fleet) item.position = world.vessels.get(item.id)!.state.position;
    this.map.setExtraOrbits(this.fleet);
    if (this.pendingBiome) this.lookAtPendingBiome();
    const focus = this.focus.kind === 'vessel'
      ? world.vessels.get(this.focus.id)!.state.position
      : world.universe.ephem.getBodyState(this.focus.id, world.ut).position;
    this.map.update({ t: world.ut, markers: world.mapGravityMarkers(), vessel: world.preciseGravity && world.active ? { position: world.active.state.position, patches: world.mapTrajectory(), nodes: world.nodes } : undefined, focusId: this.focus.kind === 'body' ? this.focus.id : `vessel:${this.focus.id}`, referenceBody: this.focus.kind === 'body' ? this.focus.id : world.vessels.get(this.focus.id)?.body, focus, comms: world.commsSettings.enabled && game.get().settings.commsOverlay ? world.comms : undefined, viewport: { width: this.width, height: this.height } });
    this.pipeline.renderer.setRenderTarget(null);
    this.pipeline.renderer.render(this.map.scene, this.map.camera);
    if (now - this.lastUi > 250) { this.refresh(); this.lastUi = now; }
    this.frame = requestAnimationFrame(this.animate);
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.detach();
    this.pipeline.detach(this.map.scene);
    this.map.dispose();
    this.pipeline.dispose();
    this.pipeline.renderer.domElement.remove();
  }
}
