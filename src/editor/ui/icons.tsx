import type { ReactElement } from 'react';
import type { PartCategory } from '../../sim/vessel/types';

/** Small original line icons (24x24, stroke = currentColor). */
const P = (d: string) => <path d={d} />;

const paths: Record<string, ReactElement> = {
  all: <>{P('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z')}</>,
  command: <>{P('M12 3c-3 3-5 7-5 11h10c0-4-2-8-5-11z')}{P('M7 14l-2 5h14l-2-5')}<circle cx="12" cy="10" r="1.6" /></>,
  fuelTank: <>{P('M7 5c0-1 2-2 5-2s5 1 5 2v14c0 1-2 2-5 2s-5-1-5-2z')}{P('M7 9h10M7 15h10')}</>,
  engine: <>{P('M9 3h6v5H9z')}{P('M10 8l-3 10h10L14 8')}{P('M9 21l1-3M15 21l-1-3M12 21v-3')}</>,
  coupling: <>{P('M5 9h14v2H5zM5 13h14v2H5z')}{P('M8 5v4M16 5v4M8 15v4M16 15v4')}</>,
  structural: <>{P('M7 3v18M17 3v18')}{P('M7 5l10 4-10 4 10 4-10 4')}</>,
  aero: <>{P('M12 2c-2.5 4-4 8-4 14h8c0-6-1.5-10-4-14z')}{P('M8 16l-3 5h14l-3-5')}</>,
  control: <>{P('M4 18L12 6l8 12z')}<circle cx="12" cy="14" r="2" /></>,
  electrical: <>{P('M13 2L5 14h6l-1 8 8-12h-6z')}</>,
  utility: <>{P('M12 3a8 8 0 0 0-8 8h16a8 8 0 0 0-8-8z')}{P('M4 11l8 10 8-10M12 11v10')}</>,
  ground: <>{P('M12 3v9M12 12l-6 7M12 12l6 7')}{P('M3 20h6M15 20h6')}</>,
  science: <>{P('M9 3h6M10 3v6l-5 10c-.5 1 .2 2 1.3 2h11.4c1.1 0 1.8-1 1.3-2l-5-10V3')}</>,
  search: <><circle cx="11" cy="11" r="6" />{P('M20 20l-4.5-4.5')}</>,
  undo: <>{P('M9 7L4 12l5 5')}{P('M4 12h11a5 5 0 0 1 0 10h-2')}</>,
  redo: <>{P('M15 7l5 5-5 5')}{P('M20 12H9a5 5 0 0 0 0 10h2')}</>,
  save: <>{P('M5 3h11l3 3v15H5z')}{P('M8 3v5h8V3M8 21v-7h8v7')}</>,
  load: <>{P('M3 7h7l2 2h9v11H3z')}</>,
  new: <>{P('M6 3h9l4 4v14H6z')}{P('M12 10v7M8.5 13.5h7')}</>,
  launch: <>{P('M12 2c3 2.5 4.5 6 4.5 10v4h-9v-4c0-4 1.5-7.5 4.5-10z')}{P('M7.5 16l-2.5 3v2l3-1M16.5 16l2.5 3v2l-3-1M10 20h4l-2 2z')}</>,
  exit: <>{P('M14 4h5v16h-5')}{P('M10 8l-4 4 4 4M6 12h10')}</>,
  com: <><circle cx="12" cy="12" r="7" />{P('M12 5v14M5 12h14')}</>,
  cot: <>{P('M12 3v13')}{P('M7 12l5 7 5-7')}</>,
  plus: <>{P('M12 5v14M5 12h14')}</>,
  trash: <>{P('M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13')}</>,
  sym: <><circle cx="12" cy="12" r="2" />{P('M12 3v5M12 16v5M3 12h5M16 12h5')}</>,
  frame: <>{P('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5')}</>,
  wand: <>{P('M4 20L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z')}</>,
};

export function Icon({ name, size = 18, stroke = 1.6 }: { name: PartCategory | keyof typeof paths; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[name] ?? paths.all}
    </svg>
  );
}
