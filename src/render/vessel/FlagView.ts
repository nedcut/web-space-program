import * as THREE from 'three';
import type { World } from '../../game/world';
import { add, sub } from '../../util/vec3';
import { qMul, qRotate } from '../../util/quat';

/** Body-fixed flags, transformed relative to the active vessel each frame. */
export class FlagView {
  readonly root = new THREE.Group();
  private objects = new Map<string, THREE.Group>();
  private pole = new THREE.CylinderGeometry(0.018, 0.024, 1.8, 8);
  private cloth = new THREE.PlaneGeometry(0.85, 0.5, 6, 2);
  private poleMaterial = new THREE.MeshStandardMaterial({ color: 0xc7d0d5, metalness: 0.75, roughness: 0.3 });
  private material: THREE.MeshStandardMaterial;
  private texture: THREE.CanvasTexture;
  constructor() {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 160;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#17334a'; c.fillRect(0,0,256,160);
    c.fillStyle = '#ef8438'; c.fillRect(0,125,256,35);
    c.strokeStyle = '#fff4db'; c.lineWidth = 5; c.beginPath(); c.ellipse(128,70,65,23,-0.4,0,Math.PI*2); c.stroke();
    c.fillStyle = '#fff4db'; c.beginPath(); c.arc(128,70,16,0,Math.PI*2); c.fill();
    c.font = 'bold 17px sans-serif'; c.textAlign = 'center'; c.fillText('WEB SPACE PROGRAM',128,148);
    this.texture = new THREE.CanvasTexture(canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshStandardMaterial({ map: this.texture, side: THREE.DoubleSide, roughness: 0.9 });
    // Supported fabric folds: a flag keeps its shape in vacuum, no wind animation.
    const p = this.cloth.attributes.position;
    for (let i=0;i<p.count;i++) p.setZ(i, Math.sin((p.getX(i)+0.425)*16)*0.025);
    this.cloth.computeVertexNormals();
  }
  update(world: World) {
    const origin = world.active?.state.position;
    if (!origin) return;
    for (const f of world.flags) {
      let g = this.objects.get(f.id);
      if (!g) {
        g = new THREE.Group();
        const pole = new THREE.Mesh(this.pole, this.poleMaterial); pole.position.y = 0.9;
        const cloth = new THREE.Mesh(this.cloth, this.material); cloth.position.set(0.44,1.48,0);
        g.add(pole,cloth); this.objects.set(f.id,g); this.root.add(g);
      }
      const q = world.universe.ephem.bodyRotation(f.body, world.ut);
      const pos = sub(add(world.universe.ephem.getBodyState(f.body, world.ut).position, qRotate(q,f.position)), origin);
      g.position.set(pos.x,pos.y,pos.z);
      const orient = qMul(q,f.orientation); g.quaternion.set(orient.x,orient.y,orient.z,orient.w);
      g.visible = Math.hypot(pos.x,pos.y,pos.z) < 10000;
    }
  }
  dispose() { this.root.removeFromParent(); this.pole.dispose(); this.cloth.dispose(); this.poleMaterial.dispose(); this.material.dispose(); this.texture.dispose(); }
}
