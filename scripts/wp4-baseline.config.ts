/** Read-only source overlay for WP4 before/after captures; does not modify the worktree.
 * WSP_WP4_BASELINE=<commit> npx vite build --config scripts/wp4-baseline.config.ts --outDir /tmp/wp4-baseline
 */
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import base from '../vite.config';
const ref = process.env.WSP_WP4_BASELINE;
if (!ref) throw new Error('Set WSP_WP4_BASELINE to the pre-WP4 commit');
const changed = new Set(execFileSync('git', ['diff', '--name-only', ref, '--', 'src'], { encoding: 'utf8' }).trim().split('\n'));
export default { ...base, plugins: [{
  name: 'wp4-baseline', enforce: 'pre' as const,
  load(id: string) {
    const path = relative(process.cwd(), id).replaceAll('\\', '/');
    if (!changed.has(path)) return;
    try { return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { return; } // Added files are unreachable from the baseline module graph.
  },
}, ...(base.plugins ?? [])] };
