import * as THREE from 'three';
import { photoMode } from '../../game/photoMode';
import { downloadFile } from '../../game/craftSharing';
import { isTyping, matches } from '../../input/bindings';
import type { RenderPipeline } from './renderer';

/** Scene-local camera state; never changes the physical sun or simulation clock. */
export class PhotoCamera {
  active = false;
  private keys = new Set<string>();
  private speed = 10;
  private dragging = false;
  private savedPosition = new THREE.Vector3();
  private savedQuaternion = new THREE.Quaternion();
  private savedFov = 50;
  private savedExposure = 1;
  private disposers: (() => void)[] = [];
  constructor(private pipeline: RenderPipeline, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private center: () => THREE.Vector3, private pause: (active: boolean) => boolean, private radius = 1000) {
    this.disposers.push(photoMode.register({ enter: () => this.enter(), leave: () => this.leave(), capture: scale => this.capture(scale) }));
    const canvas = pipeline.renderer.domElement;
    const keydown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (matches('photoMode', e) && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); if (this.active) photoMode.close(); else photoMode.open(); return; }
      if (!this.active) return;
      if (matches('menu', e)) { e.preventDefault(); e.stopImmediatePropagation(); photoMode.close(); return; }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(e.code)) { this.keys.add(e.code); e.preventDefault(); }
      e.stopImmediatePropagation();
    };
    const keyup = (e: KeyboardEvent) => { this.keys.delete(e.code); if (this.active && !isTyping(e.target)) e.stopImmediatePropagation(); };
    const down = (e: PointerEvent) => { if (!this.active) return; this.dragging = true; canvas.setPointerCapture(e.pointerId); };
    const up = () => { this.dragging = false; };
    const move = (e: PointerEvent) => {
      if (!this.active || !this.dragging) return;
      const yaw = new THREE.Quaternion().setFromAxisAngle(this.camera.up.clone().normalize(), -e.movementX * 0.003);
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -e.movementY * 0.003);
      this.camera.quaternion.premultiply(yaw).multiply(pitch).normalize();
    };
    const wheel = (e: WheelEvent) => { if (!this.active) return; e.preventDefault(); e.stopImmediatePropagation(); this.speed = THREE.MathUtils.clamp(this.speed * Math.exp(-e.deltaY * 0.002), 0.1, 500); };
    const blur = () => { this.keys.clear(); this.dragging = false; };
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup, true); window.addEventListener('blur', blur);
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('lostpointercapture', up); canvas.addEventListener('wheel', wheel, { passive: false, capture: true });
    this.disposers.push(() => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', blur); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('lostpointercapture', up); canvas.removeEventListener('wheel', wheel, true); });
  }
  private enter() {
    if (!this.pause(true)) return false;
    this.savedPosition.copy(this.camera.position); this.savedQuaternion.copy(this.camera.quaternion); this.savedFov = this.camera.fov; this.savedExposure = this.pipeline.exposure;
    this.active = true; this.keys.clear(); photoMode.set({ fov: this.camera.fov, exposure: this.pipeline.exposure, focus: Math.max(1, this.camera.position.distanceTo(this.center())) });
    return true;
  }
  private leave() {
    this.active = false; this.keys.clear(); this.dragging = false;
    this.camera.position.copy(this.savedPosition); this.camera.quaternion.copy(this.savedQuaternion); this.camera.fov = this.savedFov; this.camera.updateProjectionMatrix(); this.pipeline.exposure = this.savedExposure; this.pipeline.photoEffects.enabled = false; this.pause(false);
  }
  update(dt: number) {
    if (!this.active) return;
    const value = (positive: string, negative: string) => Number(this.keys.has(positive)) - Number(this.keys.has(negative));
    const delta = new THREE.Vector3(value('KeyD', 'KeyA'), value('KeyE', 'KeyQ'), value('KeyS', 'KeyW'));
    if (delta.lengthSq()) delta.normalize().applyQuaternion(this.camera.quaternion).multiplyScalar(dt * this.speed * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1));
    this.camera.position.add(delta);
    const center = this.center(); const offset = this.camera.position.clone().sub(center);
    if (offset.length() > this.radius) this.camera.position.copy(center).add(offset.setLength(this.radius));
    const s = photoMode.get().settings;
    this.camera.fov = s.fov; this.camera.updateProjectionMatrix(); this.pipeline.exposure = s.exposure;
    const pass = this.pipeline.photoEffects; pass.enabled = true; pass.focus = s.focus;
    for (const key of ['dof', 'vignette', 'grain', 'letterbox'] as const) pass.uniforms[key].value = s[key];
  }
  private async capture(scale: 1 | 2) {
    this.update(0);
    const canvas = this.pipeline.capture(this.scene, this.camera, scale);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG capture failed.')), 'image/png'));
    downloadFile(`web-space-${Date.now()}.png`, blob);
  }
  dispose() { this.disposers.forEach(fn => fn()); }
}
