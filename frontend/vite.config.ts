import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registruje se ručno u main.tsx, samo u pregledaču (ne u Android aplikaciji).
      injectRegister: null,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'POMAK',
        short_name: 'POMAK',
        description: 'Tvoj trening. Tvoja ishrana. Tvoj napredak.',
        lang: 'sr-Latn',
        theme_color: '#141615',
        background_color: '#f2efe9',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  server: { host: true, proxy: { '/api': { target: 'http://localhost:8001', changeOrigin: true } } },
})
