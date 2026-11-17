import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Offline-first: the app shell is cached so health workers can open it with no signal.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Consent-First Kit',
        short_name: 'ConsentKit',
        description: 'Consent-first health data collection, owned by the communities who share it.',
        theme_color: '#1f4e79',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,mp3}'],
        // Never cache API responses: answers must not linger in a browser cache.
        runtimeCaching: [],
      },
    }),
  ],
})
