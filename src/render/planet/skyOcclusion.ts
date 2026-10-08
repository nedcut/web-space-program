/**
 * An inner sphere under every surface triangle. A triangle's directions fit inside
 * a cone of this angle, so projecting each vertex onto the cone axis bounds every
 * convex combination by (R + minHeight) cos(angle). Include a float32 safety margin.
 */
export function skyOcclusionRadius(radius: number, minHeight: number, cellAngle: number): number {
  return Math.max(0, (radius + Math.min(0, minHeight)) * Math.cos(cellAngle) - Math.max(2, radius * 1e-6));
}
