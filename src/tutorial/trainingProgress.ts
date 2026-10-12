/** Rough play time per lesson in minutes, for the Training screen (estimates, not limits). */
export const LESSON_MINUTES: Readonly<Record<string, number>> = {
  building: 5, 'first-flight': 5, orbit: 10, 'moon-transfer': 15, 'moon-landing': 10, docking: 15, plane: 8, eva: 6,
};

/** The first lesson in course order that is not completed yet, or null once all are done. */
export function recommendedLesson<T extends { id: string }>(lessons: readonly T[], done: readonly string[]): T | null {
  return lessons.find(l => !done.includes(l.id)) ?? null;
}
