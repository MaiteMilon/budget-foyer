import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Budget Foyer',
        short_name: 'Budget',
        description: 'Le budget partagé du couple, simple au quotidien.',
        theme_color: '#1F6F63',
        background_color: '#F6F5F1',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Les données financières vivent dans Supabase (réseau) ; on met
        // seulement en cache l'app shell pour un démarrage instantané.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
      },
    }),
  ],
  server: { port: 5173 },
});
