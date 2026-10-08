import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { FlightController } from '../controller';
import { qRotate } from '../../util/quat';
import { dot, length, sub } from '../../util/vec3';
import { formatCountdown, formatDistance } from '../../util/format';

/** DOM surface marker at 4 Hz; Float64 body rotation/subtraction precedes camera projection. */
export function LandingMarker({ controller: c }: { controller: FlightController }) {
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const projected = new THREE.Vector3();
    const update = () => {
      const el = marker.current, result = c.mapUi.landing.displayResult, v = c.world.active;
      if (!el) return;
      const impact = result?.impact;
      if (!impact || !v || result?.body !== v.body || result.vesselId !== v.state.id || impact.time < c.world.ut || c.mapMode || v.state.telemetry.thrust > 0) { el.style.display = 'none'; return; }
      const target = qRotate(c.world.universe.ephem.bodyRotation(v.body, c.world.ut), impact.fixedPosition);
      const own = c.world.relativeState(v).position;
      const camera = c.cam.camera;
      const cameraRelative = { x: own.x + camera.position.x, y: own.y + camera.position.y, z: own.z + camera.position.z };
      const delta = sub(target, own);
      // Hide the far side; a small margin preserves markers on elevated ground at the horizon.
      if (dot(target, cameraRelative) < length(target) ** 2 - c.world.universe.body(v.body).radius * 50) { el.style.display = 'none'; return; }
      projected.set(delta.x, delta.y, delta.z).project(camera);
      const host = el.parentElement!;
      if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > .94 || Math.abs(projected.y) > .9) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.left = `${(projected.x + 1) * .5 * host.clientWidth}px`;
      el.style.top = `${(1 - projected.y) * .5 * host.clientHeight}px`;
      el.textContent = `◇ Predicted landing · ${formatDistance(length(delta))} · ${formatCountdown(impact.time - c.world.ut)}`;
      el.title = `Unpowered; ${result.attitude === 'hold' ? 'hold current attitude' : 'surface retrograde'}; drag and heating; no future staging`;
    };
    const timer = setInterval(update, 250); update();
    return () => clearInterval(timer);
  }, [c]);
  return <div ref={marker} aria-label="Predicted landing surface marker" style={{ position: 'absolute', display: 'none', transform: 'translate(-50%, -100%)', color: '#ffac66', background: '#07101bcc', padding: '4px 8px', borderRadius: 4, fontSize: 12, pointerEvents: 'none' }} />;
}
