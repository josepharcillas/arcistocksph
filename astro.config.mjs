import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  vite: {
    plugins: [
      tailwindcss(),
      VitePWA({
        // 'prompt' (not 'autoUpdate') so a new build surfaces a "Refresh" banner
        // instead of silently waiting — prevents users being stuck on a stale
        // cached bundle. We register the SW ourselves in PwaUpdater.astro.
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          name: 'ArciStocks PH',
          short_name: 'ArciStocks',
          description: 'AI-powered Philippine stock advisor',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
          ]
        }
      })
    ]
  }
});
