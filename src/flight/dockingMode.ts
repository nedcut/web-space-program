/** Docking mode is for the approach: once the active vessel has latched on, the indicator has nothing left to show. */
export function dockingModeAfterEvent(on: boolean, e: { type: string; vesselId?: string; otherId?: string }, activeId: string | null): boolean {
  if (on && e.type === 'docked' && (e.vesselId === activeId || e.otherId === activeId)) return false;
  return on;
}
