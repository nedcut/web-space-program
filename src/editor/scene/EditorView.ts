import { untintedMaterials } from '../../render/parts/materialState';
import { enqueueIdle } from '../../util/idleQueue';
import { LinkView } from '../../render/vessel/LinkView';
import { clampPixelRatio, maxDrawingEdge } from '../../render/core/drawingLimits';
import { isTyping, matches } from '../../input/bindings';
import * as THREE from 'three';
import { detachRenderer, noteDfgLut, releaseRenderer } from '../../render/releaseRenderer';
import { game } from '../../game/store';
import { getQuality } from '../../render/core/quality';
import type { PartInstance } from '../../sim/vessel/types';
import { qConj, qFromAxisAngle, qIdentity, qMul, qNormalize, qRotate, type Quat } from '../../util/quat';
import { add, sub, v3, type Vec3 } from '../../util/vec3';
import { alignNodes, counterpartMaps, freeAttachNodes, mirrorPosition, mirrorRotation, partPivot, snapAngle, transformedParts, type PartTransform, type WorldAttachNode } from '../core';
import { axisVector, TransformGizmo, type GizmoHandle } from './gizmo';
import { CATALOG, type EditorSession, type Placement, type SessionView } from '../session';
import { surfaceTransform } from '../surface';
import { StudioEnvironment } from '../../render/core/studioEnv';
import { onContextRestored } from '../../render/core/contextRecovery';
import { buildHangar, HANGAR, type Hangar } from './hangar';
import { createPartMesh, variantKey } from './partMesh';
import { engineShrouds } from '../../sim/vessel/shroud';
import { partMeshParams, prepareEngineSoot, releaseSoot, setLightAppearance, setPartDetail } from '../../render/parts';

const DEG = Math.PI / 180;
const SNAP_PX = 64;
const UP = v3(0, 1, 0);
/** Key light offset from its target (the craft centre); the shadow frustum follows the craft. */
const KEY_OFFSET = { x: 26, y: 30, z: 17 } as const;

const toV = (v: Vec3, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);
const toQ = (q: Quat, out = new THREE.Quaternion()) => out.set(q.x, q.y, q.z, q.w);
const fromV = (v: THREE.Vector3): Vec3 => v3(v.x, v.y, v.z);
/** macOS: Ctrl+click is the secondary click; Option is Alt. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Horizontal pan limit around the hall's turntable, m. */
const PAN_LIMIT = 22;

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
  if (root.userData.editorTint === (tint?.key ?? 'none')) return;
  root.userData.editorTint = tint?.key ?? 'none';
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.userData.noTint) return;
    let base = untintedMaterials.get(mesh);
    if (!base) { base = mesh.material; untintedMaterials.set(mesh, base); }
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
  private envRT: StudioEnvironment;
  private unwatchContext: () => void;
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
  private partObjs = new Map<number, { obj: THREE.Object3D; partId: string; variant: string }>();
  private sootKey = '';
  private lightKey = '';
  private visualKey = '';
  private visualVersion = 0;
  private cancelSoot: () => void = () => {};
  private raf = 0;
  private last = performance.now();
  private disposed = false;
  private unsub: () => void;
  private ro: ResizeObserver;

  // Camera rig (orbit around a target on or near the craft axis; pan moves the target horizontally)
  private yaw = 0.55; private pitch = 0.18; private dist = 18; private targetY = 6;
  private gYaw = 0.55; private gPitch = 0.18; private gDist = 18; private gTargetY = 6;
  private panX = 0; private panZ = 0; private gPanX = 0; private gPanZ = 0;
  private readonly target = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  // Offset/rotate tools
  /** Built on first use (keeps editor entry lean). */
  private gizmo: TransformGizmo | null = null;
  private gizmoHover: GizmoHandle | null = null;
  private gizmoDrag: {
    handle: GizmoHandle | null; uid: number; x0: number; y0: number; pivot: Vec3; anchor: Vec3; symmetric: boolean;
    base: PartInstance[]; t: PartTransform; plane?: THREE.Plane; start?: Vec3; key: string;
  } | null = null;
  private gizmoGesture = 0;

  // Interaction
  private mouse = new THREE.Vector2(-10, -10);
  private mousePx = { x: 0, y: 0 };
  private mouseInside = false;
  private drag: { button: number; x: number; y: number; moved: boolean; id: number; pan: boolean } | null = null;
  private altDown = false;
  private raycaster = new THREE.Raycaster();
  private placement: Placement | null = null;
  private snapKey: string | null = null;
  private craftNodes: WorldAttachNode[] = [];
  private heldNodes: WorldAttachNode[] = [];
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
  private markerGeo = new THREE.RingGeometry(0.58, 1, 32);
  private markerHaloGeo = new THREE.RingGeometry(0.4, 1.25, 32);
  private markerHaloMat = new THREE.MeshBasicMaterial({ color: 0x07111d, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, toneMapped: false, fog: false });
  private markerWorld = new THREE.Vector3();
  private markerRotation = new THREE.Quaternion();
  private markerMat = new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.95, toneMapped: false, fog: false, depthTest: false, depthWrite: false });
  private markerMatHi = new THREE.MeshBasicMaterial({ color: 0x6fe39a, transparent: true, opacity: 0.95, toneMapped: false, fog: false, depthTest: false, depthWrite: false });
  private markerMatHeld = new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.95, toneMapped: false, fog: false, depthTest: false, depthWrite: false });
  private ghostMat = new THREE.MeshStandardMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.32, roughness: 0.4, metalness: 0, emissive: 0x1a5f8a, emissiveIntensity: 0.6, depthWrite: false });
  private warnedFloating = false;
  private pixelRatio = 1;
  private prevPartCount = 0;

  constructor(private container: HTMLElement, private session: EditorSession) {
    const quality = game.get().settings.quality;
    setPartDetail(getQuality(quality).partDetail);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.debug.checkShaderErrors = !!import.meta.env?.DEV;
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = Math.min(dpr, getQuality(quality).maxPixelRatio) * game.get().settings.renderScale;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = getQuality(quality).shadowMapSize > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The hall lights and assembled craft are stationary while orbiting the camera.
    // Rebuild their shadow only for assembly/held-part changes, not every safety-net frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    // Lighting: baked studio IBL (softbox reflections on parts, glossy floor) + a three-point rig.
    // One shadow caster (the key); fill, rim and hemisphere are unshadowed.
    this.envRT = new StudioEnvironment(this.renderer, { variant: 'hangar' }, (rt) => { this.scene.environment = rt.texture; });
    this.scene.environmentIntensity = 0.62;
    this.scene.background = new THREE.Color(0x0b1018);
    this.scene.fog = new THREE.Fog(0x101c2b, 32, 125);
    const hemi = new THREE.HemisphereLight(0xbcd0ec, 0x23262c, 0.12);
    this.scene.add(hemi);
    // Key: warm, high and ~50 deg to the right of the default camera, so the shadow falls visibly across the floor.
    this.key = new THREE.DirectionalLight(0xfff3e6, 4.1);
    this.key.position.set(KEY_OFFSET.x, KEY_OFFSET.y, KEY_OFFSET.z);
    this.key.castShadow = getQuality(quality).shadowMapSize > 0;
    const sm = Math.min(getQuality(quality).shadowMapSize || 512, maxDrawingEdge(this.renderer));
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
    const rim = new THREE.DirectionalLight(0xffe6cc, 3.8);
    rim.position.set(-16, 26, -24);
    this.scene.add(rim);
    // Cool kicker from behind-right outlines the other silhouette edge against the dark hall.
    const kicker = new THREE.DirectionalLight(0xc8dcff, 2.6);
    kicker.position.set(22, 14, -20);
    this.scene.add(kicker);

    this.hangar = buildHangar(this.renderer);
    this.scene.add(this.hangar.group);
    this.hangar.bakeReflections(this.scene);
    // After a context restore the shadow depth and the floor/platform reflection probe are blank: redo both.
    this.unwatchContext = onContextRestored(this.renderer, () => {
      // The probe captures the empty hall: keep the craft out of it, as in the first bake.
      const shown = this.craftGroup.visible;
      this.craftGroup.visible = false;
      this.hangar.bakeReflections(this.scene);
      this.craftGroup.visible = shown;
      this.renderer.shadowMap.needsUpdate = true;
      this.renderedKey = '';
    });
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
    this.gPanX = 0; this.gPanZ = 0;
    if (instant) { this.dist = this.gDist; this.targetY = this.gTargetY; this.panX = this.gPanX; this.panZ = this.gPanZ; }
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
      this.renderer.shadowMap.needsUpdate = true;
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
    if (!this.gizmoDrag) this.placeGizmo(snap);
    this.com.visible = snap.showCoM && snap.stats.partCount > 0;
    this.cot.visible = snap.showCoT && !!snap.stats.centreOfThrust;
    this.col.visible = snap.showCoL && !!snap.stats.centreOfLift;
    // Names, toasts, inspector panels and symmetry without a held part only affect React.
    const visualKey = [this.sootKey, this.lightKey, heldSig, snap.held ? snap.symmetryMode : '', snap.craftType,
      snap.highlightUids.join(','), snap.selectedUids.join(','), snap.hoverUid,
      snap.mode === 'actions' ? snap.groupUids.join(',') : '', snap.tool, snap.gizmoUid,
      snap.showCoM ? JSON.stringify(snap.stats.centreOfMass) : '',
      snap.showCoT ? JSON.stringify(snap.stats.centreOfThrust) : '',
      snap.showCoL ? JSON.stringify(snap.stats.centreOfLift) : ''].join('|');
    if (visualKey !== this.visualKey) { this.visualKey = visualKey; this.visualVersion++; }
  }

  private syncCraft(snap: SessionView) {
    this.links.update(snap.craft.parts);
    const seen = new Set<number>();
    let lightKey = '';
    const shrouds = engineShrouds(snap.craft.parts, p => CATALOG.get(p.partId));
    for (const p of snap.craft.parts) {
      seen.add(p.uid);
      let entry = this.partObjs.get(p.uid);
      const def = CATALOG.get(p.partId)!;
      const params = partMeshParams(def, p.tweaks, shrouds.get(p.uid)), variant = variantKey(params);
      if (!entry || entry.partId !== p.partId || entry.variant !== variant) {
        if (entry) { releaseSoot(entry.obj); this.craftGroup.remove(entry.obj); }
        const obj = createPartMesh(def, params);
        obj.userData.uid = p.uid;
        entry = { obj, partId: p.partId, variant };
        this.partObjs.set(p.uid, entry);
        this.craftGroup.add(obj);
      }
      toV(p.position, entry.obj.position);
      toQ(p.rotation, entry.obj.quaternion);
      if (p.tweaks?.lightOn !== undefined || p.tweaks?.lightColor !== undefined || CATALOG.get(p.partId)!.modules.some(m => m.type === 'light')) {
        lightKey += `${p.uid}:${p.tweaks?.lightOn !== false}:${p.tweaks?.lightColor ?? '#fff1cf'}|`;
        setLightAppearance(entry.obj, p.tweaks?.lightOn !== false, p.tweaks?.lightColor);
      }
    }
    this.lightKey = lightKey;
    for (const [uid, e] of this.partObjs) if (!seen.has(uid)) { releaseSoot(e.obj); this.craftGroup.remove(e.obj); this.partObjs.delete(uid); }
    // Engine soot depends on where every engine sits; re-bake only when the layout changes.
    // A rebuilt variant (skirt added or removed) is a fresh, unsooted mesh.
    const sootKey = snap.craft.parts.map(p => `${p.uid}:${p.partId}:${p.position.x},${p.position.y},${p.position.z}:${p.rotation.x},${p.rotation.y},${p.rotation.z},${p.rotation.w}:${this.partObjs.get(p.uid)?.variant}`).join('|');
    if (sootKey !== this.sootKey) {
      this.renderer.shadowMap.needsUpdate = true;
      this.sootKey = sootKey;
      this.cancelSoot();
      const parts = [...this.partObjs.values()].map(e => e.obj);
      const apply = prepareEngineSoot(parts, this.craftGroup, { cloneShared: true });
      let index = 0;
      const batch = () => {
        const start = performance.now();
        do { if (index < parts.length) apply([parts[index++]]); } while (index < parts.length && performance.now() - start < 4);
        // Soot only changes existing colours. Let the idle renderer present the update.
        this.renderedKey = '';
        if (index < parts.length) this.cancelSoot = enqueueIdle(batch);
      };
      this.cancelSoot = enqueueIdle(batch);
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

  // ------------------------------------------------------------------ offset / rotate gizmo
  private placeGizmo(snap: SessionView) {
    const part = snap.gizmoUid === null || snap.held || snap.mode !== 'build' ? undefined : snap.craft.parts.find(p => p.uid === snap.gizmoUid);
    if (!part || (snap.tool !== 'offset' && snap.tool !== 'rotate')) { this.gizmo?.show(null); return; }
    const at = snap.tool === 'rotate' ? partPivot(part, CATALOG) : part.position;
    if (!this.gizmo) { this.gizmo = new TransformGizmo(); this.craftGroup.add(this.gizmo.group); }
    this.gizmo.show(snap.tool, at.x, at.y, at.z);
  }

  private startGizmoDrag(e: PointerEvent): boolean {
    const snap = this.session.getSnapshot();
    if (snap.held || snap.mode !== 'build' || (snap.tool !== 'offset' && snap.tool !== 'rotate') || snap.gizmoUid === null) return false;
    const part = snap.craft.parts.find(p => p.uid === snap.gizmoUid);
    if (!part) return false;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    let handle = this.gizmo?.pick(this.raycaster) ?? null;
    // Offset tool: dragging the part itself moves it in the view plane.
    if (!handle && (snap.tool !== 'offset' || this.pickPart()?.uid !== part.uid)) return false;
    if (!handle) handle = null;
    const pivot = snap.tool === 'rotate' ? partPivot(part, CATALOG) : part.position;
    const drag: NonNullable<EditorView['gizmoDrag']> = { handle, uid: part.uid, x0: this.mousePx.x, y0: this.mousePx.y, pivot, anchor: pivot,
      symmetric: !e.altKey, base: snap.craft.parts, t: {}, key: `gizmo:${++this.gizmoGesture}` };
    if (!handle) {
      const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
      const pw = this.craftGroup.localToWorld(toV(pivot));
      drag.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pw);
      const hit = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(drag.plane, hit)) return false;
      drag.start = fromV(this.craftGroup.worldToLocal(hit));
    }
    this.gizmoDrag = drag;
    return true;
  }

  private updateGizmoDrag(e: PointerEvent) {
    const g = this.gizmoDrag!;
    const snap = this.session.getSnapshot();
    const fine = e.shiftKey, snapOn = snap.angleSnap;
    const step = fine ? 0.01 : 0.05;
    const round = (x: number) => (snapOn ? Math.round(x / step) * step : x);
    if (!g.handle) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hit = new THREE.Vector3();
      if (!g.plane || !g.start || !this.raycaster.ray.intersectPlane(g.plane, hit)) return;
      const d = sub(fromV(this.craftGroup.worldToLocal(hit)), g.start);
      g.t = { offset: v3(round(d.x), round(d.y), round(d.z)) };
    } else if (g.handle.kind === 'offset') {
      const a = axisVector(g.handle.axis);
      const sp = new THREE.Vector2(), sa = new THREE.Vector2();
      if (!this.toScreen(g.pivot, sp) || !this.toScreen(add(g.pivot, a), sa)) return;
      const sx = sa.x - sp.x, sy = sa.y - sp.y, len2 = sx * sx + sy * sy;
      const amount = len2 < 4 ? 0 : ((this.mousePx.x - g.x0) * sx + (this.mousePx.y - g.y0) * sy) / len2;
      const k = round(amount);
      g.t = { offset: v3(a.x * k, a.y * k, a.z * k) };
    } else {
      const a = axisVector(g.handle.axis);
      const sp = new THREE.Vector2();
      if (!this.toScreen(g.pivot, sp)) return;
      const a0 = Math.atan2(-(g.y0 - sp.y), g.x0 - sp.x), a1 = Math.atan2(-(this.mousePx.y - sp.y), this.mousePx.x - sp.x);
      let delta = a1 - a0;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      // A ring whose axis faces the camera turns counter-clockwise on screen for a positive angle.
      const axisWorld = toV(a).applyQuaternion(this.craftGroup.quaternion);
      const toCamera = this.camera.position.clone().sub(this.craftGroup.localToWorld(toV(g.pivot)));
      const theta = axisWorld.dot(toCamera) >= 0 ? delta : -delta;
      g.t = { rotation: qFromAxisAngle(a, snapOn ? snapAngle(theta, (fine ? 5 : 15) * DEG) : theta) };
    }
    this.previewTransform(g);
  }

  /** Move part meshes (and the gizmo) to a gesture's result without touching the editor. */
  private previewTransform(g: NonNullable<EditorView['gizmoDrag']>) {
    const changed = transformedParts(g.base, CATALOG, g.uid, g.t, g.symmetric);
    for (const [uid, p] of changed) {
      const e = this.partObjs.get(uid);
      if (!e) continue;
      toV(p.position, e.obj.position);
      toQ(p.rotation, e.obj.quaternion);
    }
    this.links.update(g.base.map(p => changed.get(p.uid) ?? p));
    const moved = changed.get(g.uid);
    if (moved && this.gizmo?.visible) {
      const at = this.session.getSnapshot().tool === 'rotate' ? g.pivot : moved.position;
      this.gizmo!.group.position.set(at.x, at.y, at.z);
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.visualVersion++;
  }

  private endGizmoDrag(commit: boolean) {
    const g = this.gizmoDrag;
    this.gizmoDrag = null;
    if (!g) return;
    const moved = (g.t.offset && Math.hypot(g.t.offset.x, g.t.offset.y, g.t.offset.z) > 1e-9) || (g.t.rotation && Math.abs(g.t.rotation.w) < 1 - 1e-12);
    if (commit && moved) this.session.transformPart(g.uid, g.t, g.symmetric, g.key);
    else { this.lastCraft = null; this.sync(); }
  }

  // ------------------------------------------------------------------ held assembly
  private buildHeld() {
    delete this.heldGroup.userData.editorTint;
    this.heldMeshes.clear();
    this.ghostGroup.clear();
    this.ghostCount = 0;
    const shrouds = engineShrouds(this.heldParts, p => CATALOG.get(p.partId));
    for (const p of this.heldParts) {
      const def = CATALOG.get(p.partId)!;
      const obj = createPartMesh(def, partMeshParams(def, p.tweaks, shrouds.get(p.uid)));
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
        ghosts = this.counterpartGhosts(best.parent.uid, D, T, false);
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
          ghosts = this.counterpartGhosts(hit.uid, D, T, true);
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
    const heldNodes = this.heldNodes;
    if (!heldNodes.length) return null;
    const craftNodes = this.craftNodes;
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
    const n = new THREE.Vector3().subVectors(this.camera.position, this.target).setY(0);
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    n.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(this.target.x, 0, this.target.z));
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) hit.copy(this.target);
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
    this.craftNodes = freeAttachNodes(snap.craft, CATALOG).filter(n => n.id !== 'srf');
    this.heldNodes = freeAttachNodes({ parts: this.heldParts }, CATALOG).filter(n => n.id !== 'srf');
    if (!snap.held || this.session.isLinkPlacement()) return;
    const add = (n: WorldAttachNode, parent: THREE.Object3D, key: string) => {
      const mesh = new THREE.Mesh(this.markerGeo, this.markerMat);
      mesh.renderOrder = 11;
      const halo = new THREE.Mesh(this.markerHaloGeo, this.markerHaloMat);
      halo.renderOrder = 10;
      halo.userData.noTint = true;
      mesh.add(halo);
      toV(n.position, mesh.position);
      const base = 0.1 + n.size * 0.07;
      mesh.scale.setScalar(base);
      mesh.userData.noTint = true;
      parent.add(mesh);
      this.nodeMarkers.push({ mesh, key, base });
    };
    for (const n of this.craftNodes) add(n, this.nodeGroup, `${n.uid}:${n.id}`);
    for (const n of this.heldNodes) add(n, this.heldGroup, `h${n.uid}:${n.id}`);
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
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const handle = this.gizmo?.pick(this.raycaster) ?? null;
      if (this.gizmo?.setHot(handle)) this.visualVersion++;
      this.gizmoHover = handle;
      const p = handle ? null : this.pickPart();
      if (p) {
        uid = p.uid;
        // Highlight what a click would pick up: the part and its subtree (just the part in action-group mode).
        set = new Set([uid]);
        // Place/offset/rotate act on the whole symmetric set: highlight every counterpart too.
        if (snap.mode === 'build' && snap.tool !== 'reroot') for (const c of counterpartMaps(snap.craft.parts, uid, !this.altDown || snap.tool !== 'place')) set.add(c.part.uid);
        let grew = snap.mode === 'build' && snap.tool !== 'reroot';
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
    // macOS: Ctrl+click is the secondary (right) click.
    const button = e.button === 0 && e.ctrlKey && IS_MAC ? 2 : e.button;
    this.drag = { button, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, pan: button === 1 || (button === 0 && e.shiftKey && !this.session.getSnapshot().held) };
    if (button === 1) e.preventDefault();
    if (button === 0 && !this.drag.pan && this.startGizmoDrag(e)) return;
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
    if (this.gizmoDrag) { this.updateGizmoDrag(e); return; }
    d.x = e.clientX; d.y = e.clientY;
    const h = this.renderer.domElement.clientHeight || 1;
    if (d.pan) {
      this.pan(-(dx / h) * this.dist * 1.1);
      this.gTargetY += (dy / h) * this.dist * 1.1;
      this.clampTarget();
    } else if (d.button === 2 || (d.button === 0 && !this.session.getSnapshot().held)) {
      this.gYaw -= dx * 0.006;
      this.gPitch = THREE.MathUtils.clamp(this.gPitch + dy * 0.005, -0.35, 1.35);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    this.updateMouse(e);
    const d = this.drag;
    this.drag = null;
    try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    window.clearTimeout(this.longPress);
    if (this.gizmoDrag) { this.endGizmoDrag(!!d?.moved); return; }
    if (d && !d.moved && d.button === 2 && !this.session.getSnapshot().held) {
      const pick = this.pickPart();
      if (pick) this.session.openPanel(pick.uid);
      return;
    }
    if (!d || d.moved || d.button !== 0 || d.pan) return;
    this.click(e.altKey);
  };

  private onPointerLeave = () => {
    if (!this.drag) this.mouseInside = false;
  };

  /** Move the camera target sideways (screen right is positive), within the hall. */
  private pan(amount: number) {
    this.gPanX += Math.cos(this.yaw) * amount;
    this.gPanZ -= Math.sin(this.yaw) * amount;
    const r = Math.hypot(this.gPanX, this.gPanZ);
    if (r > PAN_LIMIT) { this.gPanX *= PAN_LIMIT / r; this.gPanZ *= PAN_LIMIT / r; }
  }

  private click(alt = false) {
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
    if (snap.tool === 'offset' || snap.tool === 'rotate') { this.session.setGizmo(pick?.uid ?? null); return; }
    if (snap.tool === 'reroot') { if (pick) this.session.reRoot(pick.uid); return; }
    if (pick) {
      this.hoverSet.clear();
      if (alt) this.session.copyPart(pick.uid);
      else this.session.pickUp(pick.uid);
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

  /**
   * Mouse wheel zooms in notches; a trackpad zooms smoothly with two-finger scroll or pinch (Ctrl+wheel), and pans
   * sideways with a horizontal swipe. Shift+wheel pans vertically (macOS sends it as horizontal scroll).
   */
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.updateMouse(e);
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey) {
      this.gDist = THREE.MathUtils.clamp(this.gDist * Math.exp(THREE.MathUtils.clamp(dy, -60, 60) * 0.01), 3, 60);
    } else if (e.shiftKey) {
      this.gTargetY -= THREE.MathUtils.clamp((dy || dx) / 100, -1.5, 1.5) * Math.max(0.4, this.dist * 0.06);
      this.clampTarget();
    } else if (Math.abs(dx) > Math.abs(dy)) {
      this.pan(THREE.MathUtils.clamp(dx / 100, -1.5, 1.5) * Math.max(0.3, this.dist * 0.05));
    } else {
      this.gDist = THREE.MathUtils.clamp(this.gDist * Math.pow(1.12, THREE.MathUtils.clamp(dy / 100, -1.5, 1.5)), 3, 60);
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
    if (matches('editorCancel', e)) {
      if (this.gizmoDrag) this.endGizmoDrag(false);
      else if (held) s.cancelHeld();
      else if (s.closeTopPanel()) return;
      else if (s.getSnapshot().gizmoUid !== null) s.setGizmo(null);
      // The action-groups view advertises "Esc close panel": return to building.
      else if (s.getSnapshot().mode === 'actions') s.setMode('build');
      return;
    }
    if (matches('editorDelete', e)) {
      e.preventDefault();
      if (held) s.deleteHeld();
      else if (s.getSnapshot().hoverUid !== null) s.deletePart(s.getSnapshot().hoverUid!, true);
      return;
    }
    const tool = ([['editorToolPlace', 'place'], ['editorToolOffset', 'offset'], ['editorToolRotate', 'rotate'], ['editorToolReroot', 'reroot']] as const).find(([a]) => matches(a, e))?.[1];
    if (tool) { e.preventDefault(); s.setTool(tool); return; }
    if (matches('editorAngleSnap', e)) { s.toggleAngleSnap(); return; }
    if (matches('editorSymmetry', e)) { s.cycleSymmetry(e.shiftKey ? -1 : 1); return; }
    if (matches('editorSymmetryMode', e)) { s.toggleSymmetryMode(); return; }
    if (matches('editorFrame', e)) { this.frameCraft(); return; }
    if (e.altKey) e.preventDefault();
    const snap = s.getSnapshot();
    if (!held && !((snap.tool === 'rotate' || snap.tool === 'offset') && snap.gizmoUid !== null)) return;
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
      const axis = fromV(ax.clone().applyQuaternion(this.craftGroup.quaternion.clone().invert()));
      if (held) s.rotateHeld(axis, ang);
      else if (snap.tool === 'rotate') s.transformPart(snap.gizmoUid!, { rotation: qFromAxisAngle(axis, ang) }, !e.altKey);
      else {
        // Offset tool: W/S up/down, A/D screen left/right, Q/E toward/away from the camera.
        const nudge = e.shiftKey ? 0.01 : 0.05;
        const dir = { w: UP, s: v3(0, -1, 0), a: fromV(right.clone().negate()), d: fromV(right), q: fromV(fwd.clone().negate()), e: fromV(fwd) }[rotationKey];
        const local = fromV(toV(dir).applyQuaternion(this.craftGroup.quaternion.clone().invert()));
        s.transformPart(snap.gizmoUid!, { offset: v3(local.x * nudge, local.y * nudge, local.z * nudge) }, !e.altKey);
      }
      return;
    }
    if (matches('editorReset', e) && held) { e.preventDefault(); s.resetHeldRotation(); }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.altDown = e.altKey;
  };

  // ------------------------------------------------------------------ frame loop
  private resize() {
    this.idleFor = Infinity;
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setPixelRatio(clampPixelRatio(this.pixelRatio, w, h, maxDrawingEdge(this.renderer)));
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
    const cap = game.get().settings.frameRateCap;
    if (cap && now - this.last < 1000 / cap - .5) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const k = 1 - Math.exp(-dt * 12);
    this.yaw += (this.gYaw - this.yaw) * k;
    this.pitch += (this.gPitch - this.pitch) * k;
    this.dist += (this.gDist - this.dist) * k;
    this.targetY += (this.gTargetY - this.targetY) * k;
    this.panX += (this.gPanX - this.panX) * k;
    this.panZ += (this.gPanZ - this.panZ) * k;
    const target = this.target.set(this.panX, this.targetY, this.panZ);
    const cp = Math.cos(this.pitch);
    const pos = this.camPos.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist).add(target);
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
    const key = `${this.mouse.x.toFixed(4)},${this.mouse.y.toFixed(4)},${cp2.x.toFixed(3)},${cp2.y.toFixed(3)},${cp2.z.toFixed(3)},${this.visualVersion},${this.altDown},${this.mouseInside},${!!this.drag}`;
    if (key !== this.frameKey) {
      this.frameKey = key;
      this.updateHover();
      if (this.session.getSnapshot().held) this.renderer.shadowMap.needsUpdate = true;
      this.updatePlacement();
    } else if (this.snapKey) this.pulseMarkers();
    const t1 = performance.now();
    // The hangar is static: skip GPU work while nothing moves (re-render at 2 Hz as a safety net).
    const settling = Math.abs(this.gYaw - this.yaw) + Math.abs(this.gPitch - this.pitch) + Math.abs(this.gTargetY - this.targetY) + Math.abs(this.gDist - this.dist) / Math.max(1, this.dist)
      + Math.abs(this.gPanX - this.panX) + Math.abs(this.gPanZ - this.panZ) > 1e-5;
    const changed = key !== this.renderedKey || settling || !!this.snapKey;
    this.idleFor = changed ? 0 : this.idleFor + dt;
    if (!changed && this.idleFor < 0.5) return;
    if (!changed) this.idleFor = 0;
    this.renderedKey = key;
    this.updateNodePresentation();
    this.gizmo?.updateScale(this.camera, this.renderer.domElement.clientHeight);
    this.renderer.render(this.scene, this.camera);
    const t2 = performance.now();
    this.timing = { update: t1 - t0, render: t2 - t1, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles };
  };
  private frameKey = '';
  private renderedKey = '';
  private idleFor = Infinity;
  /** Camera-facing hollow targets, with a dark keyline and a bounded CSS-pixel size. */
  private updateNodePresentation() {
    this.craftGroup.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    const pixelAngle = 2 * Math.tan(this.camera.fov * DEG / 2) / Math.max(1, this.renderer.domElement.clientHeight);
    for (const m of this.nodeMarkers) {
      m.mesh.getWorldPosition(this.markerWorld).applyMatrix4(this.camera.matrixWorldInverse);
      const pixelWorld = Math.max(0.01, -this.markerWorld.z) * pixelAngle;
      const radius = THREE.MathUtils.clamp(m.base, 6 * pixelWorld, 10 * pixelWorld);
      const pulse = m.key === this.snapKey ? 1.3 + Math.sin(performance.now() / 120) * 0.12 : 1;
      m.mesh.scale.setScalar(radius * pulse);
      m.mesh.parent!.getWorldQuaternion(this.markerRotation).invert();
      m.mesh.quaternion.copy(this.markerRotation).multiply(this.camera.quaternion);
    }
  }

  private pulseMarkers() {
    for (const m of this.nodeMarkers) if (m.key === this.snapKey) m.mesh.scale.setScalar(m.base * (1.5 + Math.sin(performance.now() / 120) * 0.2));
  }
  /** Last-frame timings (dev). */
  timing = { update: 0, render: 0, calls: 0, tris: 0 };

  dispose() {
    noteDfgLut(this.renderer, this.scene);
    detachRenderer(this.scene);
    this.disposed = true;
    this.cancelSoot();
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
    this.unwatchContext();
    this.hangar.dispose();
    this.envRT.dispose();
    this.links.dispose();
    this.linkPreviewGeometry.dispose(); this.linkPreviewMaterial.dispose();
    this.markerGeo.dispose();
    this.markerHaloGeo.dispose();
    this.markerHaloMat.dispose();
    this.markerMat.dispose();
    this.markerMatHi.dispose();
    this.markerMatHeld.dispose();
    this.ghostMat.dispose();
    this.gizmo?.dispose();
    releaseRenderer(this.renderer);
    this.renderer.domElement.remove();
  }
}

const preventDefault = (e: Event) => e.preventDefault();
