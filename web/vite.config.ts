import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'APP PALESTRA',
        short_name: 'Palestra',
        lang: 'it',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#161317',
        theme_color: '#161317',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Solo la shell dell'app: i dati passano da IndexedDB, le foto private non vengono mai messe in cache.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, handler: 'CacheFirst', options: { cacheName: 'fonts', expiration: { maxEntries: 20 } } },
        ],
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3000' } },
  preview: { port: 4173, proxy: { '/api': 'http://127.0.0.1:3000' } },
});
