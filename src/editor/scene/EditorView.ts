import { LinkView } from '../../render/vessel/LinkView';
import { isTyping, matches } from '../../input/bindings';
import * as THREE from 'three';
import { detachRenderer, noteDfgLut, releaseRenderer } from '../../render/releaseRenderer';
import { game } from '../../game/store';
import { QUALITY_PRESETS } from '../../render/core/quality';
import type { PartInstance } from '../../sim/vessel/types';
import { qConj, qFromAxisAngle, qIdentity, qMul, qNormalize, qRotate, type Quat } from '../../util/quat';
import { add, sub, v3, type Vec3 } from '../../util/vec3';
import { alignNodes, freeAttachNodes, mirrorPosition, mirrorRotation, type WorldAttachNode } from '../core';
import { CATALOG, type EditorSession, type Placement, type SessionView } from '../session';
import { surfaceTransform } from '../surface';
import { createStudioEnvironment } from '../../render/core/studioEnv';
import { buildHangar, HANGAR, type Hangar } from './hangar';
import { createPartMesh } from './partMesh';
import { bakeEngineSoot, releaseSoot, setLightAppearance } from '../../render/parts';

const DEG = Math.PI / 180;
const SNAP_PX = 64;
const UP = v3(0, 1, 0);
/** Key light offset from its target (the craft centre); the shadow frustum follows the craft. */
const KEY_OFFSET = { x: 26, y: 30, z: 17 } as const;

const toV = (v: Vec3, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);
const toQ = (q: Quat, out = new THREE.Quaternion()) => out.set(q.x, q.y, q.z, q.w);
const fromV = (v: THREE.Vector3): Vec3 => v3(v.x, v.y, v.z);

type Mat = THREE.Material | THREE.Material[];
const tintCaches = new Map<string, WeakMap<THREE.Material, THREE.Material>>();
function tinted(m: THREE.Material, key: string, color: number, intensity: number): THREE.Material {
  let cache = tintCaches.get(key);
  if (!cache) tintCaches.set(key, (cache = new WeakMap()));
  let c = cache.get(m);
  if (!c) {
    c = m.clone();
    const e = c as THREE.MeshStandardMaterial;
    if (e.emissive) {
      e.emissive = new THREE.Color(color);
      e.emissiveIntensity = intensity;
    } else if ((c as THREE.MeshBasicMaterial).color) (c as THREE.MeshBasicMaterial).color.lerp(new THREE.Color(color), 0.4);
    cache.set(m, c);
  }
  return c;
}
function setTint(root: THREE.Object3D, tint: { key: string; color: number; intensity: number } | null) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.userData.noTint) return;
    if (o.userData.baseMat === undefined) o.userData.baseMat = mesh.material;
    const base = o.userData.baseMat as Mat;
    if (!tint) mesh.material = base;
    else mesh.material = Array.isArray(base) ? base.map((b) => tinted(b, tint.key, tint.color, tint.intensity)) : tinted(base, tint.key, tint.color, tint.intensity);
  });
}

const HOVER_TINT = { key: 'hover', color: 0x2a8fd0, intensity: 0.55 };
const STAGE_TINT = { key: 'stage', color: 0xffb35c, intensity: 0.6 };
const BAD_TINT = { key: 'bad', color: 0xc02020, intensity: 0.7 };
const SNAP_TINT = { key: 'snap', color: 0x1f9a55, intensity: 0.35 };
const SELECT_TINT = { key: 'select', color: 0x79d7ee, intensity: 0.75 };
const GROUP_TINT = { key: 'group', color: 0x9b6bff, intensity: 0.6 };

/**
 * Vehicle assembly 3D view: hangar, craft meshes, held-part interaction (stack snapping, surface attach,
 * symmetry ghosts), node markers, CoM/CoT markers and the orbit camera. React-free; talks to EditorSession.
 */
export class EditorView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  private hangar: Hangar;
  private envRT: THREE.WebGLRenderTarget;
  private key: THREE.DirectionalLight;
  private craftGroup = new THREE.Group();
  private heldGroup = new THREE.Group();
  private heldMeshes = new THREE.Group();
  private ghostGroup = new THREE.Group();
  private nodeGroup = new THREE.Group();
  private links = new LinkView();
  private linkPreviewGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  private linkPreviewMaterial = new THREE.LineBasicMaterial({ color: 0x6fe39a, depthTest: false });
  private linkPreview = new THREE.Line(this.linkPreviewGeometry, this.linkPreviewMaterial);
  private com: THREE.Group;
  private cot: THREE.Group;
  private col: THREE.Group;
  /** Horizontal building (SPH): the craft frame is turned so craft +Y (nose) points along world -Z, +Z up. */
  private horizontal = false;
  private shiftZ = 0;
  private partObjs = new Map<number, { obj: THREE.Object3D; partId: string }>();
  private sootKey = '';
  private raf = 0;
  private last = performance.now();
  private disposed = false;
  private unsub: () => void;
  private ro: ResizeObserver;

  // Camera rig (orbit around craft axis x=z=0)
  private yaw = 0.55; private pitch = 0.18; private dist = 18; private targetY = 6;
  private gYaw = 0.55; private gPitch = 0.18; private gDist = 18; private gTargetY = 6;

  // Interaction
  private mouse = new THREE.Vector2(-10, -10);
  private mousePx = { x: 0, y: 0 };
  private mouseInside = false;
  private drag: { button: number; x: number; y: number; moved: boolean; id: number } | null = null;
  private altDown = false;
  private raycaster = new THREE.Raycaster();
  private placement: Placement | null = null;
  private snapKey: string | null = null;
  private lastCraft: SessionView['craft'] | null = null;
  private lastHeldSig = '';
  private lastLoad = -1;
  private lift = 3;
  private hoverSet = new Set<number>();
  private stageSet = new Set<number>();
  private selectSet = new Set<number>();
  private groupSet = new Set<number>();
  private longPress = 0;
  private heldParts: PartInstance[] = [];
  private ghostCount = 0;
  private nodeMarkers: { mesh: THREE.Mesh; key: string; base: number }[] = [];
  private markerGeo = new THREE.SphereGeometry(1, 20, 14);
  private markerMat = new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false });
  private markerMatHi = new THREE.MeshBasicMaterial({ color: 0x6fe39a, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  private markerMatHeld = new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
  private ghostMat = new THREE.MeshStandardMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.32, roughness: 0.4, metalness: 0, emissive: 0x1a5f8a, emissiveIntensity: 0.6, depthWrite: false });
  private warnedFloating = false;
  private prevPartCount = 0;

  constructor(private container: HTMLElement, private session: EditorSession) {
    const quality = game.get().settings.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, QUALITY_PRESETS[quality].maxPixelRatio) * game.get().settings.renderScale);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = game.get().settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    // Lighting: baked studio IBL (softbox reflections on parts, glossy floor) + a three-point rig.
    // One shadow caster (the key); fill, rim and hemisphere are unshadowed.
    this.envRT = createStudioEnvironment(this.renderer, { variant: 'hangar' });
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.62;
    this.scene.background = new THREE.Color(0x0b1018);
    this.scene.fog = new THREE.Fog(0x111823, 75, 180);
    const hemi = new THREE.HemisphereLight(0xbcd0ec, 0x23262c, 0.12);
    this.scene.add(hemi);
    // Key: warm, high and ~50 deg to the right of the default camera, so the shadow falls visibly across the floor.
    this.key = new THREE.DirectionalLight(0xfff3e6, 4.1);
    this.key.position.set(KEY_OFFSET.x, KEY_OFFSET.y, KEY_OFFSET.z);
    this.key.castShadow = game.get().settings.shadows;
    const sm = quality === 'high' ? 2048 : 1024;
    this.key.shadow.mapSize.set(sm, sm);
    this.key.shadow.bias = -0.0003;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.radius = quality === 'low' ? 2 : 5;
    const sc = this.key.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 28; sc.bottom = -20; sc.near = 5; sc.far = 110;
    this.scene.add(this.key, this.key.target);
    // Cool fill from the front-left keeps the shadow side readable without flattening the form.
    const fill = new THREE.DirectionalLight(0xd3e1ff, 0.42);
    fill.position.set(-16, 12, 26);
    this.scene.add(fill);
    // Soft warm rim from high behind-left separates silhouettes from the dark hall. High enough that its glint on
    // the glossy floor stays out of the usual camera angles; desaturated so it doesn't tint the floor.
    const rim = new THREE.DirectionalLight(0xffe6cc, 3.2);
    rim.position.set(-16, 26, -24);
    this.scene.add(rim);
    // Cool kicker from behind-right outlines the other silhouette edge against the dark hall.
    const kicker = new THREE.DirectionalLight(0xc8dcff, 2.2);
    kicker.position.set(22, 14, -20);
    this.scene.add(kicker);

    this.hangar = buildHangar(this.renderer);
    this.scene.add(this.hangar.group);
    this.hangar.bakeReflections(this.scene);
    this.scene.add(this.craftGroup);
    this.craftGroup.add(this.heldGroup, this.ghostGroup, this.nodeGroup, this.links.root, this.linkPreview);
    this.linkPreview.visible = false;
    this.heldGroup.add(this.heldMeshes);

    this.com = this.makeCoM();
    this.cot = this.makeCoT();
    this.col = this.makeCoL();
    this.craftGroup.add(this.com, this.cot, this.col);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', preventDefault);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.unsub = session.subscribe(() => this.sync());
    this.sync();
    this.loop();
  }

  // ------------------------------------------------------------------ public API (for UI / dev hooks)
  frameCraft(instant = false) {
    const s = this.session.getSnapshot().stats;
    const empty = !s.partCount;
    // Vertical extent in the hall: craft Y (VAB) or craft Z (SPH, built horizontally).
    const h = empty ? 7 : this.horizontal ? s.depth : s.height;
    const w = empty ? 7 : this.horizontal ? Math.max(s.width, s.height) : Math.max(s.width, s.depth);
    const centreY = empty ? this.lift : this.lift + (this.horizontal ? (s.bounds.min.z + s.bounds.max.z) / 2 : (s.bounds.min.y + s.bounds.max.y) / 2);
    const fovV = (this.camera.fov * DEG) / 2;
    const fovH = Math.atan(Math.tan(fovV) * this.camera.aspect);
    const needV = (h / 2 + 1.2) / Math.tan(fovV);
    const needH = (w / 2 + 1.5) / Math.tan(fovH);
    this.gDist = THREE.MathUtils.clamp(Math.max(needV, needH, 7) * 1.12 + w / 2, 5, 60);
    // Nudge up a little: the top bar covers part of the viewport.
    this.gTargetY = centreY + h * 0.03;
    if (instant) { this.dist = this.gDist; this.targetY = this.gTargetY; }
  }

  /** Dev hook: set the orbit camera directly (radians / metres; targetY relative to the floor). */
  setView(v: { yaw?: number; pitch?: number; dist?: number; targetY?: number }, instant = true) {
    if (v.yaw !== undefined) this.gYaw = v.yaw;
    if (v.pitch !== undefined) this.gPitch = v.pitch;
    if (v.dist !== undefined) this.gDist = v.dist;
    if (v.targetY !== undefined) this.gTargetY = v.targetY;
    if (instant) { this.yaw = this.gYaw; this.pitch = this.gPitch; this.dist = this.gDist; this.targetY = this.gTargetY; }
  }

  // ------------------------------------------------------------------ session sync
  private sync() {
    const snap = this.session.getSnapshot();
    if (snap.craftType === 'SPH' !== this.horizontal) {
      this.horizontal = snap.craftType === 'SPH';
      this.craftGroup.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.horizontal ? -Math.PI / 2 : 0);
      this.lastCraft = null;
    }
    if (snap.craft !== this.lastCraft) {
      this.lastCraft = snap.craft;
      this.syncCraft(snap);
    }
    const coreHeld = this.session.editor.held;
    const heldSig = snap.held ? `${snap.held.kind}|${snap.held.kind === 'new' ? snap.held.partId : coreHeld?.parts.map((p) => p.uid).join(',')}|${JSON.stringify(snap.held.rotation)}|${snap.symmetry}|${JSON.stringify(coreHeld?.parts[0]?.rotation ?? null)}` : '';
    if (heldSig !== this.lastHeldSig) {
      const structural = heldSig.split('|').slice(0, 2).join('|') !== this.lastHeldSig.split('|').slice(0, 2).join('|') || heldSig.split('|')[4] !== this.lastHeldSig.split('|')[4];
      this.lastHeldSig = heldSig;
      this.heldParts = this.session.heldParts();
      if (structural) this.buildHeld();
      else this.updateHeldLocal();
      this.buildNodeMarkers();
    }
    if (this.session.loadCounter !== this.lastLoad) {
      const first = this.lastLoad < 0;
      this.lastLoad = this.session.loadCounter;
      this.frameCraft(first);
    }
    // Highlights
    this.stageSet = new Set(snap.highlightUids);
    this.selectSet = new Set(snap.selectedUids);
    this.groupSet = new Set(snap.mode === 'actions' ? snap.groupUids : []);
    this.applyHighlights();
    this.com.visible = snap.showCoM && snap.stats.partCount > 0;
    this.cot.visible = snap.showCoT && !!snap.stats.centreOfThrust;
    this.col.visible = snap.showCoL && !!snap.stats.centreOfLift;
  }

  private syncCraft(snap: SessionView) {
    this.links.update(snap.craft.parts);
    const seen = new Set<number>();
    for (const p of snap.craft.parts) {
      seen.add(p.uid);
      let entry = this.partObjs.get(p.uid);
      if (!entry || entry.partId !== p.partId) {
        if (entry) { releaseSoot(entry.obj); this.craftGroup.remove(entry.obj); }
        const obj = createPartMesh(CATALOG.get(p.partId)!);
        obj.userData.uid = p.uid;
        entry = { obj, partId: p.partId };
        this.partObjs.set(p.uid, entry);
        this.craftGroup.add(obj);
      }
      toV(p.position, entry.obj.position);
      toQ(p.rotation, entry.obj.quaternion);
      if (p.tweaks?.lightOn !== undefined || p.tweaks?.lightColor !== undefined || CATALOG.get(p.partId)!.modules.some(m => m.type === 'light'))
        setLightAppearance(entry.obj, p.tweaks?.lightOn !== false, p.tweaks?.lightColor);
    }
    for (const [uid, e] of this.partObjs) if (!seen.has(uid)) { releaseSoot(e.obj); this.craftGroup.remove(e.obj); this.partObjs.delete(uid); }
    // Engine soot depends on where every engine sits; re-bake only when the layout changes.
    const sootKey = snap.craft.parts.map(p => `${p.uid}:${p.partId}:${p.position.x},${p.position.y},${p.position.z}:${p.rotation.x},${p.rotation.y},${p.rotation.z},${p.rotation.w}`).join('|');
    if (sootKey !== this.sootKey) {
      this.sootKey = sootKey;
      bakeEngineSoot([...this.partObjs.values()].map(e => e.obj), this.craftGroup, { cloneShared: true });
    }

    // Keep the craft's lowest point above the floor; shift the camera with it so the view doesn't jump.
    const s = snap.stats;
    // Lowest point (craft -Y in the VAB, craft -Z in the SPH where wheels hang below) stays above the floor.
    const low = this.horizontal ? s.bounds.min.z : s.bounds.min.y;
    let newLift = s.partCount ? Math.max(this.horizontal ? 0.6 : 3, (this.horizontal ? 0.3 : 1.0) - low) : 3;
    // While something is held, never lower the craft (the held assembly lives in craft space too).
    if (snap.held) newLift = Math.max(newLift, this.lift);
    const d = newLift - this.lift;
    if (Math.abs(d) > 1e-6) { this.lift = newLift; this.targetY += d; this.gTargetY += d; }
    this.craftGroup.position.y = this.lift;
    // SPH: centre the fuselage over the turntable (craft Y runs along world -Z); not while holding parts.
    if (!snap.held) this.shiftZ = this.horizontal && s.partCount ? (s.bounds.min.y + s.bounds.max.y) / 2 : 0;
    this.craftGroup.position.z = this.shiftZ;
    this.craftGroup.updateMatrixWorld(true);
    // Soft contact shadow sized to the craft's floor footprint (craft Y runs along world Z in the SPH).
    const b = s.bounds;
    if (s.partCount) this.hangar.setFootprint((b.max.x - b.min.x) / 2, this.horizontal ? (b.max.y - b.min.y) / 2 : (b.max.z - b.min.z) / 2, this.lift + low);
    else this.hangar.setFootprint(0, 0, 0);

    // CoM / CoT / CoL
    toV(s.centreOfMass, this.com.position);
    if (s.centreOfThrust) toV(s.centreOfThrust, this.cot.position);
    if (s.centreOfLift) toV(s.centreOfLift, this.col.position);
    const scale = THREE.MathUtils.clamp((this.horizontal ? Math.max(s.height, s.width) : s.height) / 14, 0.6, 2.2);
    this.com.scale.setScalar(scale);
    this.cot.scale.setScalar(scale);
    this.col.scale.setScalar(scale);
    this.buildNodeMarkers();
    if (snap.craft.parts.length > 0 && this.prevPartCount === 0 && this.lastLoad >= 0) this.frameCraft();
    this.prevPartCount = snap.craft.parts.length;
  }

  // ------------------------------------------------------------------ held assembly
  private buildHeld() {
    this.heldMeshes.clear();
    this.ghostGroup.clear();
    this.ghostCount = 0;
    for (const p of this.heldParts) {
      const obj = createPartMesh(CATALOG.get(p.partId)!);
      obj.userData.heldUid = p.uid;
      this.heldMeshes.add(obj);
    }
    this.updateHeldLocal();
    this.heldGroup.visible = false;
  }

  private updateHeldLocal() {
    this.heldMeshes.children.forEach((obj, i) => {
      const p = this.heldParts[i];
      if (!p) return;
      toV(p.position, obj.position);
      toQ(p.rotation, obj.quaternion);
    });
  }

  private ensureGhosts(n: number) {
    if (this.ghostCount === n) return;
    this.ghostGroup.clear();
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      for (const src of this.heldMeshes.children) {
        const c = src.clone(true);
        c.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            (o as THREE.Mesh).material = this.ghostMat;
            o.castShadow = false;
          }
        });
        g.add(c);
      }
      this.ghostGroup.add(g);
    }
    this.ghostCount = n;
  }

  /** Recompute where the held assembly would go for the current mouse position. */
  private updatePlacement() {
    const snap = this.session.getSnapshot();
    this.snapKey = null;
    this.linkPreview.visible = false;
    if (this.session.isLinkPlacement()) {
      this.placement = null; this.heldGroup.visible = false; this.ghostGroup.visible = false;
      const hit = this.surfaceHit(), start = snap.linkStart?.hit;
      if (start && this.mouseInside) {
        const end = hit?.point ?? this.cursorCraftPoint();
        const positions = this.linkPreviewGeometry.getAttribute('position');
        positions.setXYZ(0, start.point.x, start.point.y, start.point.z);
        positions.setXYZ(1, end.x, end.y, end.z); positions.needsUpdate = true;
        this.linkPreviewGeometry.computeBoundingSphere();
        const length = Math.hypot(end.x - start.point.x, end.y - start.point.y, end.z - start.point.z);
        this.linkPreviewMaterial.color.set(hit && hit.uid !== start.uid && length <= 5 && length >= 0.05 ? 0x6fe39a : 0xc02020);
        this.linkPreview.visible = true;
      }
      return;
    }
    if (!snap.held || !this.heldParts.length) {
      this.placement = null;
      this.heldGroup.visible = false;
      this.ghostGroup.visible = false;
      return;
    }
    this.heldGroup.visible = this.mouseInside || !snap.craft.parts.length;
    const craft = snap.craft;
    let D = qIdentity();
    let T = v3();
    let placement: Placement | null = null;
    let ghosts: { q: Quat; p: Vec3 }[] = [];

    if (!craft.parts.length) {
      placement = { kind: 'root' };
    } else {
      const C = this.cursorCraftPoint();
      T = C;
      const root = this.heldParts.find((p) => p.uid === (snap.held!.kind === 'new' ? -1 : this.session.heldRootUid())) ?? this.heldParts[0];
      const rootDef = CATALOG.get(root.partId)!;
      // 1) Stack snapping in screen space.
      const best = this.findStackSnap(C);
      if (best) {
        const t = alignNodes(best.childAt, best.parent);
        D = t.rotation;
        T = add(qRotate(t.rotation, C), t.position);
        placement = { kind: 'stack', parentUid: best.parent.uid, parentNode: best.parent.id, childUid: best.child.uid, childNode: best.child.id };
        this.snapKey = `${best.parent.uid}:${best.parent.id}`;
        if (snap.held.kind === 'new') ghosts = this.counterpartGhosts(best.parent.uid, D, T, false);
      } else if (rootDef.surfaceAttachable && !this.altDown && this.mouseInside) {
        // 2) Surface attachment by raycast.
        const hit = this.surfaceHit();
        if (hit) {
          const parent = craft.parts.find((p) => p.uid === hit.uid)!;
          const up = qRotate(parent.rotation, UP);
          const t = surfaceTransform(rootDef, hit.point, hit.normal, up, snap.held.rotation);
          // Held-space root rotation is R_acc * q_root; map it onto the surface orientation.
          D = qNormalize(qMul(t.rotation, qConj(root.rotation)));
          T = sub(t.position, qRotate(D, root.position));
          placement = { kind: 'surface', parentUid: hit.uid, position: t.position, rotation: t.rotation, point: hit.point, normal: hit.normal };
          if (snap.held.kind === 'new') ghosts = this.counterpartGhosts(hit.uid, D, T, true);
        }
      }
    }
    this.placement = placement;
    toQ(D, this.heldGroup.quaternion);
    toV(T, this.heldGroup.position);
    setTint(this.heldGroup, placement ? (placement.kind === 'root' ? null : SNAP_TINT) : BAD_TINT);
    this.ensureGhosts(ghosts.length);
    this.ghostGroup.visible = ghosts.length > 0 && this.heldGroup.visible;
    ghosts.forEach((g, i) => {
      const obj = this.ghostGroup.children[i];
      toQ(g.q, obj.quaternion);
      toV(g.p, obj.position);
    });
    for (const m of this.nodeMarkers) {
      const hi = m.key === this.snapKey;
      m.mesh.material = m.key.startsWith('h') ? this.markerMatHeld : hi ? this.markerMatHi : this.markerMat;
      const pulse = hi ? 1.5 + Math.sin(performance.now() / 120) * 0.2 : 1;
      m.mesh.scale.setScalar(m.base * pulse);
    }
  }

  /** Symmetry counterparts for a new part (mirrors CraftEditor.addSymmetric). */
  private counterpartGhosts(parentUid: number, D: Quat, T: Vec3, surface: boolean): { q: Quat; p: Vec3 }[] {
    const snap = this.session.getSnapshot();
    const parts = snap.craft.parts;
    const parent = parts.find((p) => p.uid === parentUid)!;
    const out: { q: Quat; p: Vec3 }[] = [];
    if (parent.symmetryGroup !== undefined) {
      for (const target of parts) {
        if (target.symmetryGroup !== parent.symmetryGroup || target.uid === parent.uid) continue;
        const delta = qMul(target.rotation, qConj(parent.rotation));
        out.push({ q: qNormalize(qMul(delta, D)), p: add(target.position, qRotate(delta, sub(T, parent.position))) });
      }
    } else if (surface && snap.symmetryMode === 'mirror') {
      if (snap.symmetry > 1) {
        // Mirror across craft YZ (the held new part sits at the held-group origin with rotation R_h).
        const rh = this.heldParts[0]?.rotation ?? qIdentity();
        const full = mirrorRotation(qMul(D, rh));
        out.push({ q: qNormalize(qMul(full, qConj(rh))), p: mirrorPosition(T) });
      }
    } else if (surface && snap.symmetry > 1) {
      for (let i = 1; i < snap.symmetry; i++) {
        const delta = qFromAxisAngle(UP, (2 * Math.PI * i) / snap.symmetry);
        out.push({ q: qNormalize(qMul(delta, D)), p: add(parent.position, qRotate(delta, sub(T, parent.position))) });
      }
    }
    return out;
  }

  private findStackSnap(C: Vec3): { child: WorldAttachNode; childAt: WorldAttachNode; parent: WorldAttachNode } | null {
    const craft = this.session.getSnapshot().craft;
    const heldNodes = freeAttachNodes({ parts: this.heldParts }, CATALOG).filter((n) => n.id !== 'srf');
    if (!heldNodes.length) return null;
    const craftNodes = freeAttachNodes(craft, CATALOG).filter((n) => n.id !== 'srf');
    let best: { child: WorldAttachNode; childAt: WorldAttachNode; parent: WorldAttachNode; rank: number } | null = null;
    const pa = new THREE.Vector2(), pb = new THREE.Vector2();
    for (const h of heldNodes) {
      const childAt: WorldAttachNode = { ...h, position: add(h.position, C) };
      if (!this.toScreen(childAt.position, pa)) continue;
      for (const c of craftNodes) {
        // Keep the player's orientation: only nodes that face each other (within ~60 degrees).
        const facing = h.direction.x * c.direction.x + h.direction.y * c.direction.y + h.direction.z * c.direction.z;
        if (facing > -0.5) continue;
        if (!this.toScreen(c.position, pb)) continue;
        const d = pa.distanceTo(pb);
        if (d > SNAP_PX) continue;
        const rank = d + (h.size === c.size ? 0 : SNAP_PX * 0.6);
        if (!best || rank < best.rank) best = { child: h, childAt, parent: c, rank };
      }
    }
    return best;
  }

  private toScreen(p: Vec3, out: THREE.Vector2): boolean {
    const v = this.craftGroup.localToWorld(toV(p)).project(this.camera);
    if (v.z > 1) return false;
    const el = this.renderer.domElement;
    out.set(((v.x + 1) / 2) * el.clientWidth, ((1 - v.y) / 2) * el.clientHeight);
    return true;
  }

  /** Cursor position on the vertical plane through the craft axis, facing the camera (craft frame). */
  private cursorCraftPoint(): Vec3 {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const n = new THREE.Vector3().subVectors(this.camera.position, new THREE.Vector3(0, this.targetY, 0)).setY(0);
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    n.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(0, 0, 0));
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) hit.set(0, this.targetY, 0);
    this.craftGroup.worldToLocal(hit);
    return fromV(hit);
  }

  private pickPart(): { uid: number; hit: THREE.Intersection } | null {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const objs = [...this.partObjs.values()].map((e) => e.obj);
    if (!this.session.isLinkPlacement()) objs.push(this.links.root);
    const hits = this.raycaster.intersectObjects(objs, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.uid === undefined) o = o.parent;
      if (o) return { uid: o.userData.uid as number, hit: h };
    }
    return null;
  }

  /** Surface hit in craft frame with a clean analytic normal for cylindrical parents. */
  private surfaceHit(): { uid: number; point: Vec3; normal: Vec3 } | null {
    const pick = this.pickPart();
    if (!pick) return null;
    const part = this.session.getSnapshot().craft.parts.find((p) => p.uid === pick.uid);
    if (!part) return null;
    const def = CATALOG.get(part.partId)!;
    if (!def.allowSurfaceAttachChildren) return null;
    const pw = this.craftGroup.worldToLocal(pick.hit.point.clone());
    let normal = new THREE.Vector3(0, 1, 0);
    if (pick.hit.face) {
      normal = pick.hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(pick.hit.object.matrixWorld)).normalize();
      normal.applyQuaternion(this.craftGroup.quaternion.clone().invert());
    }
    let point = fromV(pw);
    let n = fromV(normal);
    if (def.shape.kind === 'cylinder') {
      const inv = qConj(part.rotation);
      const lp = qRotate(inv, sub(point, part.position));
      const ln = qRotate(inv, n);
      const h = def.shape.height;
      if (Math.abs(ln.y) < 0.75 && Math.abs(lp.y) < h / 2) {
        const rho = Math.hypot(lp.x, lp.z) || 1;
        const t = lp.y / h + 0.5;
        const r = def.shape.radiusBottom + (def.shape.radiusTop - def.shape.radiusBottom) * t;
        const slope = (def.shape.radiusBottom - def.shape.radiusTop) / h;
        const lpp = v3((lp.x / rho) * r, lp.y, (lp.z / rho) * r);
        const lnn = v3(lp.x / rho, slope, lp.z / rho);
        const l = Math.hypot(lnn.x, lnn.y, lnn.z);
        point = add(part.position, qRotate(part.rotation, lpp));
        n = qRotate(part.rotation, v3(lnn.x / l, lnn.y / l, lnn.z / l));
      }
    }
    return { uid: pick.uid, point, normal: n };
  }

  // ------------------------------------------------------------------ node markers
  private buildNodeMarkers() {
    for (const m of this.nodeMarkers) m.mesh.removeFromParent();
    this.nodeMarkers = [];
    const snap = this.session.getSnapshot();
    if (!snap.held || this.session.isLinkPlacement()) return;
    const add = (n: WorldAttachNode, parent: THREE.Object3D, key: string) => {
      const mesh = new THREE.Mesh(this.markerGeo, this.markerMat);
      mesh.renderOrder = 10;
      toV(n.position, mesh.position);
      const base = 0.1 + n.size * 0.07;
      mesh.scale.setScalar(base);
      mesh.userData.noTint = true;
      parent.add(mesh);
      this.nodeMarkers.push({ mesh, key, base });
    };
    for (const n of freeAttachNodes(snap.craft, CATALOG)) if (n.id !== 'srf') add(n, this.nodeGroup, `${n.uid}:${n.id}`);
    for (const n of freeAttachNodes({ parts: this.heldParts }, CATALOG)) if (n.id !== 'srf') add(n, this.heldGroup, `h${n.uid}:${n.id}`);
  }

  // ------------------------------------------------------------------ highlights
  private applyHighlights() {
    for (const [uid, e] of this.partObjs) {
      setTint(e.obj, this.stageSet.has(uid) ? STAGE_TINT : this.selectSet.has(uid) ? SELECT_TINT : this.hoverSet.has(uid) ? HOVER_TINT : this.groupSet.has(uid) ? GROUP_TINT : null);
    }
  }

  private updateHover() {
    const snap = this.session.getSnapshot();
    let set = new Set<number>();
    let uid: number | null = null;
    if (!snap.held && this.mouseInside && !this.drag) {
      const p = this.pickPart();
      if (p) {
        uid = p.uid;
        // Highlight what a click would pick up: the part and its subtree (just the part in action-group mode).
        set = new Set([uid]);
        let grew = snap.mode === 'build';
        while (grew) {
          grew = false;
          for (const q of snap.craft.parts) if (q.parent !== undefined && set.has(q.parent) && !set.has(q.uid)) { set.add(q.uid); grew = true; }
        }
      }
    }
    const changed = set.size !== this.hoverSet.size || [...set].some((u) => !this.hoverSet.has(u));
    if (changed) { this.hoverSet = set; this.applyHighlights(); }
    this.session.setHover(uid);
  }

  // ------------------------------------------------------------------ markers
  private makeCoM(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true, opacity: 0.95 });
    const dark = new THREE.MeshBasicMaterial({ color: 0x222222, depthTest: false, transparent: true, opacity: 0.95 });
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16, 0, Math.PI / 2), mat);
    // Classic quartered CoM ball: alternate yellow/black quadrants.
    for (let i = 0; i < 4; i++) {
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 8, (i * Math.PI) / 2, Math.PI / 2, 0, Math.PI / 2), i % 2 ? dark : mat);
      const bot = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 8, (i * Math.PI) / 2, Math.PI / 2, Math.PI / 2, Math.PI / 2), i % 2 ? mat : dark);
      g.add(top, bot);
    }
    s.geometry.dispose();
    g.traverse((o) => { o.renderOrder = 20; o.userData.noTint = true; });
    g.visible = false;
    return g;
  }

  private makeCoT(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xc061ff, depthTest: false, transparent: true, opacity: 0.95 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 12), mat);
    shaft.position.y = -0.8;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 16), mat);
    head.rotation.x = Math.PI;
    head.position.y = -1.9;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 24), mat);
    ring.rotation.x = Math.PI / 2;
    g.add(shaft, head, ring);
    g.traverse((o) => { o.renderOrder = 20; o.userData.noTint = true; });
    g.visible = false;
    return g;
  }

  /** Centre of lift: blue ball with an arrow along the lift direction (craft +Z = "up" for aircraft). */
  private makeCoL(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x3fa9ff, depthTest: false, transparent: true, opacity: 0.95 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 14), mat);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 10), mat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.75;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 14), mat);
    head.rotation.x = Math.PI / 2;
    head.position.z = 1.6;
    g.add(ball, shaft, head);
    g.traverse((o) => { o.renderOrder = 21; o.userData.noTint = true; });
    g.visible = false;
    return g;
  }

  // ------------------------------------------------------------------ input
  private updateMouse(e: PointerEvent | WheelEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mousePx = { x: e.clientX - r.left, y: e.clientY - r.top };
    this.mouse.set((this.mousePx.x / r.width) * 2 - 1, -(this.mousePx.y / r.height) * 2 + 1);
    this.altDown = e.altKey;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.updateMouse(e);
    this.mouseInside = true;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    if (e.button === 1) e.preventDefault();
    window.clearTimeout(this.longPress);
    if (e.pointerType === 'touch') {
      // Touch long-press opens the part inspector (right-click equivalent).
      const d = this.drag;
      this.longPress = window.setTimeout(() => {
        if (this.drag !== d || d.moved || this.session.getSnapshot().held) return;
        d.moved = true; // consume: no click on release
        const pick = this.pickPart();
        if (pick) this.session.openPanel(pick.uid);
      }, 550);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    this.updateMouse(e);
    this.mouseInside = true;
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
    if (!d.moved) return;
    d.x = e.clientX; d.y = e.clientY;
    const h = this.renderer.domElement.clientHeight || 1;
    if (d.button === 2 || (d.button === 0 && !this.session.getSnapshot().held)) {
      this.gYaw -= dx * 0.006;
      this.gPitch = THREE.MathUtils.clamp(this.gPitch + dy * 0.005, -0.35, 1.35);
    } else if (d.button === 1) {
      this.gTargetY += (dy / h) * this.dist * 1.1;
      this.clampTarget();
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    this.updateMouse(e);
    const d = this.drag;
    this.drag = null;
    try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    window.clearTimeout(this.longPress);
    if (d && !d.moved && d.button === 2 && !this.session.getSnapshot().held) {
      const pick = this.pickPart();
      if (pick) this.session.openPanel(pick.uid);
      return;
    }
    if (!d || d.moved || d.button !== 0) return;
    this.click();
  };

  private onPointerLeave = () => {
    if (!this.drag) this.mouseInside = false;
  };

  private click() {
    const snap = this.session.getSnapshot();
    if (this.session.isLinkPlacement()) {
      const hit = this.surfaceHit();
      if (hit) this.session.placeLinkHit(hit);
      else this.session.toast('Click a part surface to anchor the link', 'warn');
      return;
    }
    if (snap.held) {
      this.updatePlacement();
      if (this.placement) this.session.place(this.placement);
      else if (!this.warnedFloating) {
        this.warnedFloating = true;
        this.session.toast('Attach to a glowing node or a part surface · Del or drop on the parts list to discard', 'warn');
      }
      return;
    }
    const pick = this.pickPart();
    if (pick && snap.mode === 'actions') { this.session.openPanel(pick.uid); return; }
    if (pick) {
      this.hoverSet.clear();
      this.session.pickUp(pick.uid);
    }
  }

  /** Screen position (CSS px within the canvas) of a part centre, or null when behind the camera. */
  partScreenPosition(uid: number): { x: number; y: number } | null {
    const e = this.partObjs.get(uid);
    if (!e) return null;
    const v = e.obj.getWorldPosition(new THREE.Vector3()).project(this.camera);
    if (v.z > 1) return null;
    const el = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight };
  }
  /** Pointer position for hover tooltips (CSS px within the canvas), when inside and not dragging. */
  pointer(): { x: number; y: number } | null {
    return this.mouseInside && !this.drag ? { ...this.mousePx } : null;
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.updateMouse(e);
    const delta = e.deltaY || e.deltaX;
    if (e.shiftKey) {
      this.gTargetY -= Math.sign(delta) * Math.max(0.4, this.dist * 0.06);
      this.clampTarget();
    } else {
      this.gDist = THREE.MathUtils.clamp(this.gDist * Math.pow(1.12, Math.sign(delta)), 3, 60);
    }
  };

  private clampTarget() {
    const top = this.lift + Math.max(4, this.session.getSnapshot().stats.bounds.max.y + 2);
    this.gTargetY = THREE.MathUtils.clamp(this.gTargetY, 0.5, Math.min(HANGAR.height - 4, top));
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.repeat) return;
    this.altDown = e.altKey;
    const s = this.session;
    const held = s.getSnapshot().held;
    if (matches('editorRedo', e)) { e.preventDefault(); s.redo(); return; }
    if (matches('editorUndo', e)) { e.preventDefault(); s.undo(); return; }
    if (matches('editorSave', e)) { e.preventDefault(); s.save(); return; }
    if (matches('editorCancel', e)) { if (held) s.cancelHeld(); else s.closeTopPanel(); return; }
    if (matches('editorDelete', e)) {
      e.preventDefault();
      if (held) s.deleteHeld();
      else if (s.getSnapshot().hoverUid !== null) s.deletePart(s.getSnapshot().hoverUid!);
      return;
    }
    if (matches('editorSymmetry', e)) { s.cycleSymmetry(e.shiftKey ? -1 : 1); return; }
    if (matches('editorSymmetryMode', e)) { s.toggleSymmetryMode(); return; }
    if (matches('editorFrame', e)) { this.frameCraft(); return; }
    if (e.altKey) e.preventDefault();
    if (!held) return;
    const step = (e.shiftKey ? 5 : 15) * DEG;
    // Camera-relative axes: W/S pitch about screen-right, A/D roll about view direction, Q/E yaw about vertical.
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const axes: Record<string, [THREE.Vector3, number]> = {
      w: [right, -step], s: [right, step], a: [fwd, -step], d: [fwd, step], q: [new THREE.Vector3(0, 1, 0), step], e: [new THREE.Vector3(0, 1, 0), -step],
    };
    const rotationKey = ([['editorPitchUp', 'w'], ['editorPitchDown', 's'], ['editorRollLeft', 'a'], ['editorRollRight', 'd'], ['editorYawLeft', 'q'], ['editorYawRight', 'e']] as const).find(([a]) => matches(a, e))?.[1];
    if (rotationKey) {
      e.preventDefault();
      const [ax, ang] = axes[rotationKey];
      // Camera axes are in the hall (world); held rotations are in the craft frame.
      s.rotateHeld(fromV(ax.clone().applyQuaternion(this.craftGroup.quaternion.clone().invert())), ang);
      return;
    }
    if (matches('editorReset', e)) { e.preventDefault(); s.resetHeldRotation(); }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.altDown = e.altKey;
  };

  // ------------------------------------------------------------------ frame loop
  private resize() {
    this.idleFor = Infinity;
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const k = 1 - Math.exp(-dt * 12);
    this.yaw += (this.gYaw - this.yaw) * k;
    this.pitch += (this.gPitch - this.pitch) * k;
    this.dist += (this.gDist - this.dist) * k;
    this.targetY += (this.gTargetY - this.targetY) * k;
    const target = new THREE.Vector3(0, this.targetY, 0);
    const cp = Math.cos(this.pitch);
    const pos = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist).add(target);
    // Stay inside the hall.
    pos.x = THREE.MathUtils.clamp(pos.x, -HANGAR.halfX + 2, HANGAR.halfX - 2);
    pos.z = THREE.MathUtils.clamp(pos.z, -HANGAR.halfZ + 2, HANGAR.halfZ - 2);
    pos.y = THREE.MathUtils.clamp(pos.y, 0.6, HANGAR.height - 3);
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    // Shadow frustum follows the craft.
    this.key.target.position.set(0, this.lift + 4, 0);
    this.key.position.set(KEY_OFFSET.x, this.lift + 4 + KEY_OFFSET.y, KEY_OFFSET.z);

    const t0 = performance.now();
    // Raycasts only when something that affects them changed (mouse, camera, craft, held state, Alt).
    const cp2 = this.camera.position;
    const key = `${this.mouse.x.toFixed(4)},${this.mouse.y.toFixed(4)},${cp2.x.toFixed(3)},${cp2.y.toFixed(3)},${cp2.z.toFixed(3)},${this.session.getSnapshot().version},${this.altDown},${this.mouseInside},${!!this.drag}`;
    if (key !== this.frameKey) {
      this.frameKey = key;
      this.updateHover();
      this.updatePlacement();
    } else if (this.snapKey) this.pulseMarkers();
    const t1 = performance.now();
    // The hangar is static: skip GPU work while nothing moves (re-render at 2 Hz as a safety net).
    const settling = Math.abs(this.gYaw - this.yaw) + Math.abs(this.gPitch - this.pitch) + Math.abs(this.gTargetY - this.targetY) + Math.abs(this.gDist - this.dist) / Math.max(1, this.dist) > 1e-5;
    const changed = key !== this.renderedKey || settling || !!this.snapKey;
    this.idleFor = changed ? 0 : this.idleFor + dt;
    if (!changed && this.idleFor < 0.5) return;
    if (!changed) this.idleFor = 0;
    this.renderedKey = key;
    this.renderer.render(this.scene, this.camera);
    const t2 = performance.now();
    this.timing = { update: t1 - t0, render: t2 - t1, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles };
  };
  private frameKey = '';
  private renderedKey = '';
  private idleFor = Infinity;
  private pulseMarkers() {
    for (const m of this.nodeMarkers) if (m.key === this.snapKey) m.mesh.scale.setScalar(m.base * (1.5 + Math.sin(performance.now() / 120) * 0.2));
  }
  /** Last-frame timings (dev). */
  timing = { update: 0, render: 0, calls: 0, tris: 0 };

  dispose() {
    noteDfgLut(this.renderer, this.scene);
    detachRenderer(this.scene);
    this.disposed = true;
    for (const e of this.partObjs.values()) releaseSoot(e.obj);
    window.clearTimeout(this.longPress);
    cancelAnimationFrame(this.raf);
    this.unsub();
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    // three keeps disposed renderers reachable from shared materials; the canvas must not pin this view.
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', preventDefault);
    this.hangar.dispose();
    this.envRT.dispose();
    this.links.dispose();
    this.linkPreviewGeometry.dispose(); this.linkPreviewMaterial.dispose();
    this.markerGeo.dispose();
    this.markerMat.dispose();
    this.markerMatHi.dispose();
    this.markerMatHeld.dispose();
    this.ghostMat.dispose();
    releaseRenderer(this.renderer);
    this.renderer.domElement.remove();
  }
}

const preventDefault = (e: Event) => e.preventDefault();
