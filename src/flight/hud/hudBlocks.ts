/**
 * The HUD blocks that take pointer events (the `pointer-events: auto` rules in hud.css). The map nudges orbit
 * markers and captions out from under them so they stay readable and clickable.
 */
export const HUD_BLOCKS = [
  '.hud-left > :not(.hud-left-fill):not(.hud-left-bottom):not(.hud-messages)',
  '.hud-top > :not(.hud-messages)',
  '.hud-right > .app-bar',
  '.app-stack > *',
  '.crew-dock > *',
  '.hud-bottom > *',
  '.hud > .app-win',
  '.hud > .feel-hint',
  '.stg > :not(.stg-scroll)',
  '.stg-scroll > *',
  // Children that stick out of their parent's box (the Δv tags beside the stages, the speed readout above the ball).
  '.stg-dv',
  '.nb-speed',
].join(', ');
