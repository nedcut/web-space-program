import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Keep optimizer artifacts local when worktrees share installed dependencies.
  cacheDir: '.vite-cache',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), ...(process.env.WSP_PROFILE === '1' ? { 'react-dom/client': 'react-dom/profiling' } : {}) } },
  define: { 'import.meta.env.WSP_PROFILE': JSON.stringify(process.env.WSP_PROFILE === '1') },
  plugins: [
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
