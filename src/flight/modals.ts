import type { FlightAction } from './input';

/**
 * Flight-scene modals. The Controls reference sits on top of whatever was showing: opened from the Pause
 * menu it keeps the flight paused and closing it returns to the menu; opened in flight it pauses local
 * simulation and suspends input until closed. Multiplayer suspends local controls; its shared clock continues.
 */
export const pauseMenuVisible = (s: { paused: boolean; help: boolean }) => s.paused && !s.help;
/** While flight input is suspended only the menu toggle (Esc closes the modal) and quickload act; a momentary SAS hold still restores itself. */
export const actionAllowedWhileSuspended = (a: FlightAction) => a === 'menu' || a === 'quickload' || a === 'sasHoldRelease';
