import type { StateVector } from './api';
import { add, cross, dot, length, normalize, scale, sub } from '../../util/vec3';

export const LAGRANGE_PAIRS = [['sun','earth'],['earth','moon'],['sun','jupiter'],['saturn','titan']] as const;
/** Instantaneous circular restricted-three-body equilibria in the pair's orbital plane.
 * Collinear roots use the full mass ratio (not the small-secondary Hill approximation).
 * For eccentric/perturbed pairs these are moving reference markers, not exact equilibria.
 */
export function lagrangePoints(primaryGM: number, secondaryGM: number, primary: StateVector, secondary: StateVector) {
  const mu = secondaryGM/(primaryGM+secondaryGM), r = sub(secondary.position,primary.position);
  const v = sub(secondary.velocity,primary.velocity), distance = length(r);
  const xAxis = normalize(r), normal = normalize(cross(r,v)), yAxis = cross(normal,xAxis);
  const omega = scale(normal,length(cross(r,v))/distance**2), radial = dot(v,xAxis)/distance;
  const force = (x: number) => x-(1-mu)*(x+mu)/Math.abs(x+mu)**3-mu*(x-1+mu)/Math.abs(x-1+mu)**3;
  const root = (lo: number, hi: number) => {
    for (let i = 0; i < 80; i++) { const mid = (lo+hi)/2; if (force(mid)>0) hi=mid; else lo=mid; }
    return (lo+hi)/2;
  };
  return [[root(-mu+1e-12,1-mu-1e-12),0], [root(1-mu+1e-12,3),0],
    [root(-3,-mu-1e-12),0], [.5-mu,Math.sqrt(3)/2], [.5-mu,-Math.sqrt(3)/2]].map(([x,y],i) => {
    const offset = add(scale(xAxis,(x+mu)*distance),scale(yAxis,y*distance));
    return { name: `L${i+1}`, position: add(primary.position,offset),
      velocity: add(primary.velocity,add(cross(omega,offset),scale(offset,radial))) };
  });
}
