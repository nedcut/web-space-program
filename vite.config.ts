import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Cross-origin isolation lets the terrain workers share one SharedArrayBuffer Earth grid (src/game/earthLoader.ts).
// Every asset is same-origin, so require-corp costs nothing; static hosts get the same pair from public/_headers.
const isolationHeaders = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  // Keep optimizer artifacts local when worktrees share installed dependencies.
  cacheDir: '.vite-cache',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), ...(process.env.WSP_PROFILE === '1' ? { 'react-dom/client': 'react-dom/profiling' } : {}) } },
  define: { 'import.meta.env.WSP_PROFILE': JSON.stringify(process.env.WSP_PROFILE === '1') },
  plugins: [
    // Read-only baseline source overlay for paired production UI probes in this worktree.
    ...(process.env.WSP_UI_BASELINE ? [{
      name: 'ui-benchmark-baseline', enforce: 'pre' as const,
      load(id: string) {
        const path = relative(process.cwd(), id).replaceAll('\\', '/');
        if (!['src/editor/scene/EditorView.ts', 'src/editor/scene/thumbnails.ts', 'src/editor/session.ts',
          'src/editor/ui/CraftThumbnail.tsx', 'src/editor/ui/Palette.tsx', 'src/editor/ui/StagingPanel.tsx', 'src/editor/ui/editor.css',
          'src/flight/hud/AppLauncher.tsx', 'src/flight/hud/hud.css', 'src/ui/theme.css'].includes(path)) return;
        return execFileSync('git', ['show', `${process.env.WSP_UI_BASELINE}:${path}`], { encoding: 'utf8' });
      },
    }] : []),
    react(),
    {
      name: 'available-earth-imagery',
      apply: 'build',
      writeBundle(options) {
        // Advertise optional levels only when their entire pack is in this build.
        // Runs before PWA closeBundle so its manifest hash covers the final JSON.
        const dir = resolve(options.dir ?? 'dist', 'earth/imagery');
        const path = resolve(dir, 'manifest.json');
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        manifest.levels = manifest.levels.filter((level: { optional?: boolean; day: string; tiles: number }) => {
          if (!level.optional) return true;
          for (let month = 1; month <= 12; month++) {
            for (let tile = 0; tile < level.tiles; tile++) {
              const file = level.day.replace('{MM}', String(month).padStart(2, '0')).replace('{T}', String(tile));
              if (!existsSync(resolve(dir, file))) return false;
            }
          }
          return true;
        });
        writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Web Space Program',
        short_name: 'WSP',
        theme_color: '#05070d',
        background_color: '#05070d',
        display: 'fullscreen',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      // Earth imagery packs (8k/16k) are fetched on demand and kept in their own Cache Storage bucket.
      workbox: { navigateFallbackAllowlist: [/^\/(?:\?.*)?$/], globPatterns: ['**/*.{js,css,html,svg,png,jpg,webp,glsl,json,i16,u4,md}'], globIgnores: ['**/earth/imagery/packs/**'], maximumFileSizeToCacheInBytes: 20_000_000 },
    }),
  ],
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], environment: 'node', setupFiles: ['./scripts/earth-data/register.ts'] },
});
