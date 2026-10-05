import type { AchievementState } from './achievements';
const KEY = 'wsp.achievements.v1';
export interface AchievementProfile { unlocked: AchievementState; flags: string[] }
export function loadAchievements(): AchievementProfile {
  try {
    const data: unknown = JSON.parse(typeof localStorage === 'undefined' ? 'null' : localStorage.getItem(KEY) ?? 'null');
    if (data && typeof data === 'object' && 'unlocked' in data && 'flags' in data) {
      const p = data as AchievementProfile;
      return { unlocked: Object.fromEntries(Object.entries(p.unlocked).filter(([, t]) => typeof t === 'number' && Number.isFinite(t))), flags: [...new Set(p.flags.filter(b => typeof b === 'string'))] };
    }
  } catch { /* Unavailable or corrupt storage starts an empty profile. */ }
  return { unlocked: {}, flags: [] };
}
export function saveAchievements(profile: AchievementProfile) {
  try { const existing = loadAchievements(); localStorage.setItem(KEY, JSON.stringify({ unlocked: { ...existing.unlocked, ...profile.unlocked }, flags: [...new Set([...existing.flags, ...profile.flags])] })); } catch { /* Keep awards in memory. */ }
}
