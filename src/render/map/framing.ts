
export function smallBodyVisible(kind: string, heliocentric: boolean, targeted: boolean): boolean {
  return kind !== 'asteroid' && kind !== 'comet' || heliocentric || targeted;
}

/**
 * Whether trajectory patch `k` is drawn around its central body as that body is now (true), or around where the body
 * will be when the patch starts (false). The current patch, and later patches around a body whose family the path
 * has not yet left (the Moon, then Earth after leaving it, then the Sun), share the present frame. A return to a body
 * the path has left is a future re-encounter: drawn around the body now it stacked phantom flybys across the current
 * one. The camera focus's first encounter is the exception, drawn around the focused body as it is now so that the
 * flyby passes its sphere on screen.
 */
export function patchDrawnNow(patches: readonly { orbit: { body: string } }[], k: number, focusId: string | undefined,
  parent: (id: string) => string | undefined): boolean {
  if (k <= 0) return true;
  const body = patches[k].orbit.body;
  let first = body === focusId;
  for (let j = 0; first && j < k; j++) if (patches[j].orbit.body === body) first = false;
  if (first) return true;
  for (let j = 0; j < k; j++) {
    let inside = false;
    for (let id: string | undefined = patches[j].orbit.body; id && !inside; id = parent(id)) inside = id === body;
    if (!inside) return false;
  }
  return true;
}

/**
 * Camera distance from the focus along the unit direction (`dx`,`dy`,`dz`) that keeps the camera outside a sphere of
 * radius `clearance` centred at `body` (focus-relative): `distance` itself when that is already outside, else the far
 * side of the sphere. Rotating, zoom easing and focus changes can each carry the camera inside the reference body.
 */
export function clearDistance(distance: number, dx: number, dy: number, dz: number, body: { x: number; y: number; z: number }, clearance: number): number {
  const along = dx * body.x + dy * body.y + dz * body.z, b2 = body.x * body.x + body.y * body.y + body.z * body.z;
  const c = b2 - clearance * clearance, inside = distance * distance - 2 * distance * along + c < 0;
  return inside ? along + Math.sqrt(along * along - c) : distance;
}
