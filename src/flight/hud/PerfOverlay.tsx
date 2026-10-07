import { useEffect, useRef, useState } from 'react';
import type { FlightController } from '../controller';
import { frameProfiler, PROFILE_HISTORY, PROFILE_SECTIONS, type ProfileSummary } from '../../util/frameProfiler';
import { useGame } from '../../game/store';

const LABELS: Record<(typeof PROFILE_SECTIONS)[number], string> = {
  input: 'Input/assist', sim: 'Simulation', vessels: 'Vessel views', fx: 'Camera/FX', planets: 'Planets/site/sky',
  map: 'Map update', render: 'Render submit', telemetry: 'Telemetry', audio: 'Audio', navball: 'Navball', hud: 'HUD (React)',
};

function gpuName(c: FlightController): string {
  try {
    const gl = c.pipeline.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch { return 'unknown'; }
}

interface Snapshot { s: ProfileSummary; gpuMs: number; calls: number; tris: number; programs: number; textures: number; geometries: number; w: number; h: number; scale: number; heapMB: number }

function snapshot(c: FlightController): Snapshot {
  const p = c.pipeline;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return { s: frameProfiler.summary(), gpuMs: p.gpuMs, calls: p.stats.calls, tris: p.stats.triangles, programs: p.stats.programs,
    textures: p.stats.textures, geometries: p.stats.geometries, w: p.renderer.domElement.width, h: p.renderer.domElement.height,
    scale: p.effectiveRenderScale, heapMB: mem ? mem.usedJSHeapSize / 1048576 : NaN };
}

function report(c: FlightController, x: Snapshot, quality: string, adaptive: boolean): string {
  const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');
  return [
    `Web Space Program performance · ${new Date().toISOString()}`,
    `GPU: ${gpuName(c)} · quality ${quality} · adaptive ${adaptive ? 'on' : 'off'} · ${x.w}×${x.h} px (3D scale ${f(x.scale, 2)}${c.pipeline.upscaling ? ', upscaled' : ''}) · DPR ${devicePixelRatio}`,
    `FPS ${f(x.s.fps)} · frame p50 ${f(x.s.frameMs.p50)} / p95 ${f(x.s.frameMs.p95)} / p99 ${f(x.s.frameMs.p99)} / max ${f(x.s.frameMs.max)} ms · hitches >25 ms: ${x.s.hitches25}, >50 ms: ${x.s.hitches50} (last ${x.s.frames} frames)`,
    `CPU ${f(x.s.cpuMs.avg, 2)} ms avg, p95 ${f(x.s.cpuMs.p95, 2)} ms · GPU ${f(x.gpuMs, 2)} ms · ${x.calls} draws · ${x.tris.toLocaleString()} tris · ${x.programs} programs · ${x.textures} textures · ${x.geometries} geometries · heap ${f(x.heapMB, 0)} MB`,
    ...PROFILE_SECTIONS.map((k) => `  ${LABELS[k].padEnd(18)} ${f(x.s.sections[k], 2)} ms`),
    `Vessels ${c.world.vessels.size} · body ${c.world.active?.body ?? '-'} · map ${c.mapMode}`,
  ].join('\n');
}

/** Detailed performance overlay (Settings → Graphics, or F8). Enables the frame profiler while shown. */
export function PerfOverlay({ controller: c }: { controller: FlightController }) {
  const quality = useGame((s) => s.settings.quality);
  const adaptive = useGame((s) => s.settings.adaptiveQuality);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [copied, setCopied] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    frameProfiler.reset();
    frameProfiler.enabled = true;
    const buf = new Float64Array(PROFILE_HISTORY);
    const draw = () => {
      const g = canvas.current?.getContext('2d');
      if (!g) return;
      const W = g.canvas.width, H = g.canvas.height, scaleY = H / 50; // 0–50 ms
      g.clearRect(0, 0, W, H);
      const n = frameProfiler.graph(buf);
      const bw = W / PROFILE_HISTORY;
      for (let i = 0; i < n; i++) {
        const v = buf[i];
        g.fillStyle = v > 33.4 ? '#ff6b6b' : v > 17.5 ? '#ffc94d' : '#5fd38d';
        const hgt = Math.min(H, v * scaleY);
        g.fillRect((PROFILE_HISTORY - n + i) * bw, H - hgt, Math.max(1, bw - 0.2), hgt);
      }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (const ms of [16.7, 33.3]) g.fillRect(0, H - ms * scaleY, W, 1);
    };
    const graph = window.setInterval(draw, 250);
    const text = window.setInterval(() => setSnap(snapshot(c)), 500);
    return () => { window.clearInterval(graph); window.clearInterval(text); frameProfiler.enabled = false; };
  }, [c]);

  const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');
  const s = snap?.s;
  return (
    <div className="panel mono perf-overlay" role="status" aria-label="Performance overlay"
      style={{ position: 'absolute', top: 64, right: 12, width: 290, padding: 10, fontSize: 11, lineHeight: 1.45, zIndex: 30, pointerEvents: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 13 }}>{s ? f(s.fps, 0) : '–'} fps</strong>
        <span style={{ color: 'var(--text-dim)' }}>{quality}{adaptive ? ' · adaptive' : ''} · F8</span>
      </div>
      <canvas ref={canvas} width={270} height={54} style={{ width: 270, height: 54, display: 'block', margin: '4px 0' }} />
      {snap && s && <>
        <div>frame p50 {f(s.frameMs.p50)} · p95 {f(s.frameMs.p95)} · p99 {f(s.frameMs.p99)} · max {f(s.frameMs.max, 0)} ms</div>
        <div>hitches &gt;25 ms {s.hitches25} · &gt;50 ms {s.hitches50}</div>
        <div>CPU {f(s.cpuMs.avg, 2)} ms (p95 {f(s.cpuMs.p95, 2)}) · GPU {Number.isFinite(snap.gpuMs) ? `${f(snap.gpuMs, 2)} ms` : 'n/a'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 8, margin: '4px 0' }}>
          {PROFILE_SECTIONS.map((k) => [<span key={k} style={{ color: 'var(--text-dim)' }}>{LABELS[k]}</span>, <span key={`${k}v`}>{f(s.sections[k], 2)}</span>])}
        </div>
        <div>{snap.calls} draws · {(snap.tris / 1000).toFixed(0)}k tris · {snap.programs} programs</div>
        <div>{snap.w}×{snap.h} px ({f(snap.scale * 100, 0)}%) · tex {snap.textures} · geo {snap.geometries}{Number.isFinite(snap.heapMB) ? ` · heap ${f(snap.heapMB, 0)} MB` : ''}</div>
        <button className="btn small" style={{ marginTop: 6 }} onClick={() => {
          const text = report(c, snapshot(c), quality, adaptive);
          void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
          console.info(text);
        }}>{copied ? 'Copied report' : 'Copy report'}</button>
      </>}
    </div>
  );
}
