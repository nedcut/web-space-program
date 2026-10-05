import { useEffect, useRef, useState } from 'react';
import { Button, Panel } from '../../ui/components';
import { formatDuration } from '../../ui/format';
import type { FlightAlert } from '../alerts';
import { CAMERA_MODE_INFO, type CameraMode } from '../camera';
import type { WarpTargetId } from '../controller/warp';
import type { Hint } from '../hints';
import type { SituationBannerText } from '../situation';
import './feel.css';

/** HUD "feel" layer: cautions, camera mode, staging flash and warp-to. */
export interface FeelTelemetry {
  alerts: FlightAlert[];
  cameraMode: CameraMode;
  stagedCount: number;
  warpTargets: { id: WarpTargetId; label: string; in: number }[];
  warpTo: { label: string; remaining: number } | null;
  /** Whole seconds left on the launch countdown. */
  countdown: number | null;
  hint: Hint | null;
}

/** Caution/warning lamps: red for immediate danger, amber for attention. Highest priority first. */
export function AlertStack({ alerts }: { alerts: FlightAlert[] }) {
  if (!alerts.length) return null;
  return (
    <div className="feel-alerts" role="alert" aria-live="assertive">
      {alerts.slice(0, 3).map((a) => (
        <div key={a.id} className={`feel-alert ${a.level}`}>{a.text}</div>
      ))}
    </div>
  );
}

export function CameraModeChip({ mode, onCycle }: { mode: CameraMode; onCycle?: () => void }) {
  const info = CAMERA_MODE_INFO[mode];
  return (
    <Button className="btn small feel-cam" onClick={onCycle} title={`Camera: ${info.label} — ${info.hint} (V to change)`}>
      CAM <span className="mono">{info.label.toUpperCase()}</span>
    </Button>
  );
}

/** Warp-to popover next to the warp rate: next node / Ap / Pe / SOI, or the active target with cancel. */
export function WarpToControl({ feel, onWarpTo, onCancel }: { feel: FeelTelemetry; onWarpTo?: (id: WarpTargetId) => void; onCancel?: () => void }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!host.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  if (feel.warpTo) {
    return (
      <Button className="btn small feel-warpto active" onClick={onCancel} title="Cancel warp-to">
        ⇥ {feel.warpTo.label} <span className="mono">{formatDuration(feel.warpTo.remaining)}</span> ✕
      </Button>
    );
  }
  if (!feel.warpTargets.length || !onWarpTo) return null;
  return (
    <div className="feel-warpto-host" ref={host}>
      <Button className="btn small feel-warpto" onClick={() => setOpen((o) => !o)} title="Warp to an event" aria-expanded={open}>⇥</Button>
      {open && (
        <Panel className="feel-warpto-menu">
          <div className="label">Warp to</div>
          {feel.warpTargets.map((o) => (
            <Button key={o.id} className="btn small" onClick={() => { setOpen(false); onWarpTo(o.id); }}>
              <span>{o.label}</span>
              <span className="mono">{formatDuration(o.in)}</span>
            </Button>
          ))}
        </Panel>
      )}
    </div>
  );
}

/** Brief "STAGE n" flash when a stage fires (static under Reduce motion via the global rule). */
export function StageFlash({ count, stage }: { count: number; stage: number }) {
  const [shown, setShown] = useState<{ key: number; stage: number } | null>(null);
  const first = useRef(count);
  // Read the stage only at the moment of the flash.
  const stageRef = useRef(stage);
  useEffect(() => { stageRef.current = stage; }, [stage]);
  useEffect(() => {
    if (count === first.current) return;
    setShown({ key: count, stage: stageRef.current + 1 });
    const id = window.setTimeout(() => setShown(null), 1100);
    return () => window.clearTimeout(id);
  }, [count]);
  if (!shown) return null;
  return <div key={shown.key} className="feel-stage-flash" aria-hidden>STAGE {shown.stage}</div>;
}

export function Countdown({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <div className="feel-countdown" aria-live="assertive">
      <div key={value} className="n">{value}</div>
      <div className="label">Space to launch now</div>
    </div>
  );
}

export function FlightHint({ hint, onDismiss, navballSize = 200 }: { hint: Hint | null; onDismiss?: () => void; navballSize?: number }) {
  if (!hint) return null;
  return (
    <Panel className="feel-hint" role="note" style={{ bottom: navballSize + 92 }}>
      <span style={{ flex: 1 }}>{hint.text}</span>
      <Button className="btn small ghost" onClick={onDismiss} title="Hide this hint">✕</Button>
    </Panel>
  );
}

/** Vessel name + situation, shown for a few seconds when a flight starts. */
export function ArrivalBanner({ banner }: { banner: SituationBannerText | null }) {
  if (!banner) return null;
  return (
    <div className="feel-banner" aria-live="polite">
      <div className="name">{banner.name}</div>
      <div className="sub">{banner.sub}</div>
    </div>
  );
}
