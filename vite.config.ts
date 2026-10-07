import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';

export default defineConfig({
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
          'src/editor/ui/CraftThumbnail.tsx', 'src/editor/ui/Palette.tsx', 'src/editor/ui/editor.css',
          'src/flight/hud/AppLauncher.tsx', 'src/flight/hud/hud.css', 'src/ui/theme.css'].includes(path)) return;
        return execFileSync('git', ['show', `${process.env.WSP_UI_BASELINE}:${path}`], { encoding: 'utf8' });
      },
    }] : []),
    react(),
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
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,jpg,webp,glsl,json,i16,md}'], maximumFileSizeToCacheInBytes: 20_000_000 },
    }),
  ],
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], environment: 'node', setupFiles: ['./scripts/earth-data/register.ts'] },
});
