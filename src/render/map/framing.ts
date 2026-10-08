
export function smallBodyVisible(kind: string, heliocentric: boolean, targeted: boolean): boolean {
  return kind !== 'asteroid' && kind !== 'comet' || heliocentric || targeted;
}
