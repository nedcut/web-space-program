import type { ReactElement } from 'react';
import type { VesselKind } from './fleet';

/** Original line icons for vessel kinds (24×24, stroke = currentColor). */
const P = (d: string) => <path d={d} />;
const ICONS: Record<VesselKind, ReactElement> = {
  station: <>{P('M9 9h6v6H9zM2 10h5v4H2zM17 10h5v4h-5zM7 12h2M15 12h2M12 3v6M12 15v6M10 3h4M10 21h4')}</>,
  base: <>{P('M4 18a8 8 0 0 1 16 0zM2 21h20M12 10V5M12 5h4l-1 1.5L16 8h-4')}</>,
  ship: <>{P('M12 3c-3 3-5 7-5 11h10c0-4-2-8-5-11zM7 14l-2 5h14l-2-5')}<circle cx="12" cy="10" r="1.6" /></>,
  lander: <>{P('M8 5h8v8H8zM8 13l-4 6M16 13l4 6M2 19h4M18 19h4M10 13l-1 3h6l-1-3')}</>,
  rover: <>{P('M3 14h18v-4H3zM6 10V7h7v3M17 10V6')}<circle cx="6" cy="17" r="2" /><circle cx="12" cy="17" r="2" /><circle cx="18" cy="17" r="2" /></>,
  plane: <>{P('M12 2c1 1 1.5 3 1.5 5v12l2.5 2h-8l2.5-2V7c0-2 .5-4 1.5-5zM3 14l7.5-4M21 14l-7.5-4')}</>,
  probe: <>{P('M9 9h6v6H9zM3 9v6h6M21 9v6h-6M12 9V5M9 3a3 3 0 0 0 6 0')}</>,
  astronaut: <><circle cx="12" cy="8" r="4" />{P('M10 8h4M6 21v-4a6 6 0 0 1 12 0v4')}</>,
  debris: <>{P('M4 8l5-3 2 5-4 2zM14 4l5 2-2 4-4-1zM10 15l6-1 2 5-6 2z')}</>,
  flag: <>{P('M6 21V3M6 4h12l-3 4 3 4H6')}</>,
};

export function KindIcon({ kind, size = 16 }: { kind: VesselKind; size?: number }) {
  return <svg className="ui-icon tracking-kind-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[kind]}</svg>;
}
