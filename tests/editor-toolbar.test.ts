import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Layout regression for the editor toolbar (browser evidence: scripts/bugfix5-browser.mjs toolbar,
// docs/screenshots/bugfix5/). Launch and Exit must stay visible and clickable down to 760 px wide.
const css = readFileSync(new URL('../src/editor/ui/editor.css', import.meta.url), 'utf8');
const tsx = readFileSync(new URL('../src/editor/ui/TopBar.tsx', import.meta.url), 'utf8');
const rule = (selector: string, from = css) => from.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
const media = (px: number) => css.match(new RegExp(`@media \\(max-width: ${px}px\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';

describe('editor toolbar at narrow widths', () => {
  it('keeps Launch and Exit outside the clipping tool area', () => {
    const tools = tsx.indexOf('className="vab-tools"'), launch = tsx.indexOf('vab-launch'), exit = tsx.indexOf('vab-exit');
    expect(tools).toBeGreaterThan(0);
    // The tools container closes before the More menu, Launch and Exit.
    const toolsEnd = tsx.indexOf('<div className="vab-more"');
    expect(toolsEnd).toBeGreaterThan(tools);
    expect(launch).toBeGreaterThan(toolsEnd); expect(exit).toBeGreaterThan(launch);
    expect(rule('.vab-tools')).toMatch(/min-width: 0/);
    expect(rule('.vab-tools')).toMatch(/overflow: hidden/);
    expect(rule('.vab-launch')).toMatch(/flex-shrink: 0/);
    expect(css).toMatch(/\.vab-topbar > \.vab-exit[^{]*\{ flex-shrink: 0; \}/);
  });
  it('moves file, sharing and marker tools into the More menu below 1200 px', () => {
    expect(media(1200)).toMatch(/\.vab-topbar \.vab-collapsible \{ display: none; \}/);
    expect(media(1200)).toMatch(/\.vab-more \{ display: block; \}/);
    expect(rule('.vab-more')).toMatch(/display: none/);
    for (const label of ['New craft', 'Load craft', 'Save craft', 'Copy share code', 'Export', 'Import', 'Centre of mass', 'Centre of thrust', 'Centre of lift']) expect(tsx).toContain(`item('${label}`);
    expect((tsx.match(/vab-collapsible/g) ?? []).length).toBe(3);
  });
});
