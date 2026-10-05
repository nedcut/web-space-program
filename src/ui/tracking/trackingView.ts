import { MapView, type ExtraOrbit } from '../../render/map/MapView';
import { RenderPipeline, getQuality } from '../../render/core';
import { game, applyCommsSettings } from '../../game/store';
import type { World } from '../../game/world';
import { RAILS_WARP } from '../../game/timewarp';
import { neutralInput } from '../../sim/vessel';

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
    private focused: (focus: TrackingFocus) => void) {
    this.pipeline = new RenderPipeline({ quality: getQuality(game.get().settings.quality) });
    const canvas = this.pipeline.renderer.domElement;
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
    host.appendChild(canvas);
    this.map = new MapView(world.universe.bodies, world.universe.ephem, host, getQuality(game.get().settings.quality), world.universe);
    this.focus = { kind: 'body', id: world.universe.sunId };
    this.setFocus(this.focus);
    this.detach = this.map.attachControls(canvas, () => this.focus.kind === 'body' ? world.universe.body(this.focus.id).radius * 1.2 : 10);
    canvas.addEventListener('dblclick', this.doubleClick);
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

  private doubleClick = (event: MouseEvent) => {
    const rect = this.host.getBoundingClientRect();
    const hit = this.map.pick((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    if (hit) this.setFocus(hit);
  };

  private animate = (now: number) => {
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
    }
    // Refresh positions each frame without rebuilding the conics.
    for (let i = this.fleet.length-1; i >= 0; i--) if (!world.vessels.has(this.fleet[i].id)) this.fleet.splice(i,1);
    for (const item of this.fleet) item.position = world.vessels.get(item.id)!.state.position;
    this.map.setExtraOrbits(this.fleet);
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
    this.pipeline.renderer.domElement.removeEventListener('dblclick', this.doubleClick);
    this.map.dispose();
    this.pipeline.dispose();
    this.pipeline.renderer.domElement.remove();
  }
}
