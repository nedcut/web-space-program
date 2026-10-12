import { game } from '../game/store';
import { useEffect, useRef, useState } from 'react';

/** Immediate canvas fallback crossfades into the shared planetary renderer. */
export function MenuBackdrop() {
  const live = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    // Load three.js and compile the Saturn shaders once the menu is interactive (the 2D
    // fallback below is visible meanwhile), so they do not compete with the first clicks.
    const load = () => import('./planetPreview').then(({ mountPlanetPreview }) => {
      if (disposed) return;
      try { cleanup = mountPlanetPreview(live.current!, 'saturn', 'standard', true, setReady); }
      catch { setReady(false); }
    }).catch(() => setReady(false));
    // Safari lacks requestIdleCallback.
    const hasIdle = typeof window.requestIdleCallback === 'function';
    const handle = hasIdle ? window.requestIdleCallback(() => void load(), { timeout: 1500 }) : window.setTimeout(() => void load(), 300);
    return () => { disposed = true; if (hasIdle) window.cancelIdleCallback(handle); else window.clearTimeout(handle); cleanup?.(); };
  }, []);
  const ref = useRef<HTMLCanvasElement>(null);

  // The 2D fallback runs only until the live planet is ready (or for good without WebGL). With reduced
  // motion it draws once per resize instead of every frame.
  useEffect(() => {
    if (ready) return;
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let seed = 1337;
    let dirty = true;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stars = Array.from({ length: 900 }, () => ({ x: rand(), y: rand(), m: rand() ** 3, t: rand() * 6.28 }));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');

    const resize = () => {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      dirty = true;
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      const still = game.get().settings.reduceMotion || reduced.matches;
      if (still && !dirty) return;
      dirty = false;
      const w = canvas.width;
      const h = canvas.height;
      const t = still ? 0 : time / 1000;
      ctx.fillStyle = '#04060c';
      ctx.fillRect(0, 0, w, h);

      // Milky-way haze
      const g = ctx.createLinearGradient(0, h, w, 0);
      g.addColorStop(0.3, 'rgba(40,50,90,0)');
      g.addColorStop(0.5, 'rgba(70,80,130,0.12)');
      g.addColorStop(0.7, 'rgba(40,50,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // One fill colour, per-star alpha: no colour strings per star per frame.
      ctx.fillStyle = 'rgb(220,230,255)';
      for (const s of stars) {
        ctx.globalAlpha = 0.35 + 0.65 * s.m * (0.8 + 0.2 * Math.sin(t * 1.5 + s.t));
        const r = (0.4 + s.m * 1.4) * devicePixelRatio;
        ctx.fillRect(((s.x + t * 0.002) % 1) * w, s.y * h, r, r);
      }
      ctx.globalAlpha = 1;
      // Ringed planet
      const cx = w * 0.72;
      const cy = h * 0.55;
      const R = Math.min(w, h) * 0.2;
      const tilt = -0.42;
      const drawRings = (front: boolean) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.scale(1, 0.28);
        ctx.beginPath();
        if (front) ctx.rect(-R * 3, 0, R * 6, R * 3);
        else ctx.rect(-R * 3, -R * 3, R * 6, R * 3);
        ctx.clip();
        for (let i = 0; i < 70; i++) {
          const rr = R * (1.25 + i * 0.016);
          const gap = i > 44 && i < 48;
          const alpha = gap ? 0.03 : 0.12 + 0.18 * Math.abs(Math.sin(i * 1.7));
          ctx.strokeStyle = `rgba(226,205,160,${alpha})`;
          ctx.lineWidth = R * 0.017;
          ctx.beginPath();
          ctx.arc(0, 0, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      };
      drawRings(false);
      const pg = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.4, R * 0.1, cx, cy, R);
      pg.addColorStop(0, '#f3dfb0');
      pg.addColorStop(0.6, '#c9a46a');
      pg.addColorStop(1, '#3a2a18');
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.clip();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      for (let i = -10; i < 10; i++) {
        ctx.fillStyle = `rgba(120,80,40,${0.05 + 0.05 * Math.abs(Math.sin(i * 2.3))})`;
        ctx.fillRect(-R, i * R * 0.1, R * 2, R * 0.05);
      }
      ctx.restore();
      drawRings(true);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [ready]);

  return <>
    <canvas ref={ref} className="fullscreen" style={{ width: '100%', height: '100%', opacity: ready ? 0 : 1, transition: 'opacity 0.6s ease' }} />
    <canvas ref={live} aria-hidden="true" className="fullscreen" style={{ width: '100%', height: '100%', opacity: ready ? 1 : 0, transition: 'opacity 0.6s ease' }} />
  </>;
}
