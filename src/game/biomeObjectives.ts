import type { Progression } from '../sim/science/progression';

/** A biome an active objective sends the player to (map highlight and label). */
export interface BiomeObjective { body: string; biome: string; label: string; title: string }

/** Biomes named by accepted contracts, one entry per body and biome. */
export function biomeObjectives(p: Progression): BiomeObjective[] {
  const out: BiomeObjective[] = [];
  for (const c of p.contracts) {
    if (c.status !== 'active' || !c.biome || out.some(o => o.body === c.body && o.biome === c.biome)) continue;
    out.push({ body: c.body, biome: c.biome, label: `${c.biome} — contract target`, title: c.title });
  }
  return out;
}
