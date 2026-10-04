/** Minimal Nelder–Mead simplex minimiser. */
export function nelderMead(f: (x: number[]) => number, x0: number[], steps: number[], maxIter = 300, tol = 1e-9): { x: number[]; fx: number } {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] += steps[i];
    simplex.push(x);
  }
  let values = simplex.map(f);
  for (let it = 0; it < maxIter; it++) {
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);
    if (Math.abs(values[n] - values[0]) <= tol * (Math.abs(values[0]) + 1e-12) && it > 2 * n) break;
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    const lerpTo = (k: number) => centroid.map((c, j) => c + k * (simplex[n][j] - c));
    const xr = lerpTo(-1), fr = f(xr);
    if (fr < values[0]) {
      const xe = lerpTo(-2), fe = f(xe);
      if (fe < fr) { simplex[n] = xe; values[n] = fe; } else { simplex[n] = xr; values[n] = fr; }
    } else if (fr < values[n - 1]) {
      simplex[n] = xr; values[n] = fr;
    } else {
      const xc = fr < values[n] ? lerpTo(-0.5) : lerpTo(0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, values[n])) { simplex[n] = xc; values[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((x, j) => simplex[0][j] + 0.5 * (x - simplex[0][j]));
          values[i] = f(simplex[i]);
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i <= n; i++) if (values[i] < values[best]) best = i;
  return { x: simplex[best], fx: values[best] };
}

