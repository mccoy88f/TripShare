import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Serve i dati delle emoji (emojibase) dall'app, invece che da una CDN: funziona anche offline. */
function localEmojibase(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('emojibase-data/package.json'));
  const files = ['it', 'en'].flatMap((l) => [`${l}/data.json`, `${l}/messages.json`]);
  return {
    name: 'tripshare-local-emojibase',
    configureServer(server) {
      server.middlewares.use('/emojibase', (req, res, next) => {
        const file = (req.url ?? '').replace(/^\//, '').split('?')[0]!;
        if (!files.includes(file)) return next();
        res.setHeader('content-type', 'application/json');
        res.end(readFileSync(join(root, file)));
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({
          type: 'asset',
          fileName: `emojibase/${file}`,
          source: readFileSync(join(root, file)),
        });
      }
    },
  };
}

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    localEmojibase(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'TripShare',
        short_name: 'TripShare',
        description: 'Viaggi di gruppo e spese condivise',
        lang: 'it',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f8fafc',
        theme_color: '#0d9488',
        categories: ['travel', 'finance', 'lifestyle'],
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // Le API non passano dalla cache del service worker.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/emojibase/'),
            handler: 'CacheFirst',
            options: { cacheName: 'emojibase', expiration: { maxEntries: 8 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/files/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 24 * 3600 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
});
