import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Layout regression for the editor toolbar (browser evidence: scripts/bugfix5-browser.mjs toolbar,
// docs/screenshots/bugfix5/). Launch and Exit must stay visible and clickable down to 760 px wide.
// UX-6: labelled exit leads the bar; captioned groups; sharing moved into the File group.
const css = readFileSync(new URL('../src/editor/ui/editor.css', import.meta.url), 'utf8');
const tsx = readFileSync(new URL('../src/editor/ui/TopBar.tsx', import.meta.url), 'utf8');
const rule = (selector: string, from = css) => from.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
const media = (px: number) => css.match(new RegExp(`@media \\(max-width: ${px}px\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';

describe('editor toolbar at narrow widths', () => {
  it('keeps Launch and the labelled exit outside the clipping tool area', () => {
    const tools = tsx.indexOf('className="vab-tools"'), launch = tsx.indexOf('vab-launch'), exit = tsx.indexOf('vab-exit');
    expect(tools).toBeGreaterThan(0);
    // Exit leads the bar (same place as the facility back controls); Launch follows the tool row and More menu.
    expect(exit).toBeGreaterThan(0); expect(exit).toBeLessThan(tools);
    expect(tsx).toMatch(/vab-exit-label">Space Center</);
    const toolsEnd = tsx.indexOf('<div className="vab-more"');
    expect(toolsEnd).toBeGreaterThan(tools);
    expect(launch).toBeGreaterThan(toolsEnd);
    expect(rule('.vab-tools')).toMatch(/min-width: 0/);
    expect(rule('.vab-tools')).toMatch(/overflow: hidden/);
    expect(rule('.vab-launch')).toMatch(/flex-shrink: 0/);
    expect(rule('.vab-exit.btn')).toMatch(/flex-shrink: 0/);
  });
  it('captions the toolbar groups', () => {
    for (const label of ['File', 'Edit', 'Tools', 'Symmetry', 'Overlays']) expect(tsx).toContain(`<Group label="${label}"`);
    // Sharing lives in the File group (menu), not floating over the hangar.
    expect(tsx).not.toContain('vab-sharing');
    expect(css).not.toMatch(/\.vab-sharing/);
  });
  it('moves the file and overlay groups into the More menu below 1500 px (room for the build tools)', () => {
    expect(media(1500)).toMatch(/\.vab-topbar \.vab-collapsible \{ display: none; \}/);
    expect(media(1500)).toMatch(/\.vab-more \{ display: block; \}/);
    expect(rule('.vab-more')).toMatch(/display: none/);
    for (const label of ['New craft', 'Open craft library', 'Save craft', 'Copy share code', 'Export file', 'Import…', 'Centre of mass', 'Centre of thrust', 'Centre of lift']) expect(tsx).toContain(`item('${label}`);
    expect((tsx.match(/className="vab-collapsible"/g) ?? []).length).toBe(2);
  });
});
