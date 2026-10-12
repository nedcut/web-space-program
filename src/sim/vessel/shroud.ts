import type { AttachNode, PartDef, PartTweaks } from './types';

/**
 * Engine shrouds (interstage skirts). A liquid engine with a part stacked on its bottom node is enclosed by a
 * frustum skirt from the part above it (or its own mount) down to the part below, so stacked stages read as one
 * continuous body instead of a bare nozzle balanced on the next stage. Purely topological and render-facing: the
 * skirt is part of the engine's dry mass and the drag model already treats stacked faces as covered (DECISIONS).
 *
 * The skirt holds while the engine's lower neighbour is attached. When that neighbour is a stack decoupler, firing it
 * jettisons the skirt (the render throws its panels clear) and the upper stage flies on with its nozzle exposed.
 */
export interface EngineShroud {
  /** Skirt radius at the engine's top node, m. */
  radiusTop: number;
  /** Skirt radius at the engine's bottom node (the next stage), m. */
  radiusBottom: number;
  /** How far the skirt continues below the engine's bottom node over a decoupler and taper, m (usually 0). */
  length: number;
  /** UID of the decoupler that jettisons the skirt, else of the part closing it below. */
  below: number;
}

interface Contact<P> { part: P; def: PartDef; node: AttachNode | undefined }

/** Minimal part view shared by editor craft parts and flight part states. */
export interface ShroudPart {
  uid: number;
  parent?: number | null;
  attachNode?: string;
  parentNode?: string;
  activated?: boolean;
  tweaks?: PartTweaks;
}

/** Engine meshes that carry a skirt: bell engines whose nozzle exit sits on the bottom node. */
const SHROUD_MESHES = new Set(['engine']);
/** Thin stack parts a skirt may continue over when a taper below widens to the next stage. */
const SKIRTED_MESHES = new Set(['decoupler', 'separator', 'adapter']);

export const hasShroudOption = (def: PartDef): boolean =>
  SHROUD_MESHES.has(def.mesh) && def.shape.kind === 'cylinder' && def.attachNodes.some(n => n.id === 'bottom');

/** Radius of a stack part's hull at one of its axial attach nodes, or undefined for box/sideways nodes. */
function nodeRadius(def: PartDef, node: AttachNode | undefined): number | undefined {
  if (!node || def.shape.kind !== 'cylinder' || Math.abs(node.direction.y) < 0.9) return undefined;
  return node.direction.y > 0 ? def.shape.radiusTop : def.shape.radiusBottom;
}

/** The axial node opposite the one a stack part is entered through. */
const farNode = (c: Contact<unknown>): AttachNode | undefined =>
  c.def.attachNodes.find(n => n.id !== c.node?.id && (n.id === 'top' || n.id === 'bottom'));

const round = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Skirts for every shrouded engine in an assembly. `defOf` resolves catalogue definitions (editor parts carry IDs,
 * flight parts their definition). Deterministic and allocation-light; call on topology changes, not per frame.
 */
export function engineShrouds<P extends ShroudPart>(parts: readonly P[], defOf: (p: P) => PartDef | undefined): Map<number, EngineShroud> {
  const out = new Map<number, EngineShroud>();
  let byUid: Map<number, P> | undefined;
  let children: Map<number, P[]> | undefined;
  for (const e of parts) {
    const def = defOf(e);
    if (!def || !hasShroudOption(def) || e.tweaks?.shroud === false || def.shape.kind !== 'cylinder') continue;
    if (!byUid) {
      byUid = new Map(parts.map(p => [p.uid, p]));
      children = new Map();
      for (const p of parts) if (p.parent !== undefined && p.parent !== null) {
        const list = children.get(p.parent);
        if (list) list.push(p); else children.set(p.parent, [p]);
      }
    }
    // Stack neighbour on a node of a part: a child attached there, or the parent the part hangs from.
    const neighbour = (x: P, nodeId: string): Contact<P> | undefined => {
      for (const c of children!.get(x.uid) ?? []) {
        if (c.parentNode !== nodeId || !c.attachNode || c.attachNode === 'srf') continue;
        const d = defOf(c);
        if (d) return { part: c, def: d, node: d.attachNodes.find(n => n.id === c.attachNode) };
      }
      if (x.attachNode === nodeId && x.parent !== undefined && x.parent !== null && x.parentNode && x.parentNode !== 'srf') {
        const par = byUid!.get(x.parent), d = par && defOf(par);
        if (par && d) return { part: par, def: d, node: d.attachNodes.find(n => n.id === x.parentNode) };
      }
      return undefined;
    };
    const below = neighbour(e, 'bottom');
    if (!below) continue;
    // A narrow decoupler and a taper below the engine are covered too, so the skirt reaches the wide stage.
    const chain: Contact<P>[] = [];
    let end = below, endNode = below.node, covered = 1, length = 0, walked = 0;
    for (let c: Contact<P> | undefined = below; c && chain.length < 3 && SKIRTED_MESHES.has(c.def.mesh);) {
      const far = farNode(c);
      if (!far || !c.node) break;
      chain.push(c);
      walked += Math.abs(far.position.y - c.node.position.y);
      if (c.def.mesh === 'adapter') { end = c; endNode = far; length = walked; covered = chain.length; }
      c = neighbour(c.part, far.id);
    }
    // The skirt leaves with the stage below when the first decoupler it covers (or sits on) fires.
    const separator = (chain.length ? chain.slice(0, covered) : [below]).find(c => c.def.modules.some(m => m.type === 'decoupler'));
    if (separator?.part.activated) continue;
    const rBelow = nodeRadius(end.def, endNode);
    if (rBelow === undefined) continue;
    const above = neighbour(e, 'top');
    const rAbove = above ? nodeRadius(above.def, above.node) : undefined;
    // Never narrower than the engine's own mount or nozzle envelope.
    out.set(e.uid, {
      radiusTop: round(Math.max(def.shape.radiusTop, rAbove ?? 0)),
      radiusBottom: round(Math.max(def.shape.radiusBottom, rBelow)),
      length: round(length),
      below: (separator ?? below).part.uid,
    });
  }
  return out;
}
