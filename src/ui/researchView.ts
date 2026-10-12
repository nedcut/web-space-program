import type { TechNode } from '../data/technology';

/** The node the Research Lab opens on: the first one ready to research (affordable first), else the root. */
export function defaultTechSelection(nodes: readonly TechNode[], unlocked: (id: string) => boolean, science: number): string {
  const ready = nodes.filter(n => !unlocked(n.id) && n.requires.every(unlocked));
  return (ready.find(n => n.cost <= science) ?? ready[0] ?? nodes[0]).id;
}
