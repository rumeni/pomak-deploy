import { execFileSync } from 'node:child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function buildSha(): string {
  for (const candidate of [process.env.VERCEL_GIT_COMMIT_SHA, process.env.GITHUB_SHA]) {
    if (candidate && /^[0-9a-f]{40}$/i.test(candidate)) return candidate.toLowerCase()
  }
  try {
    const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (/^[0-9a-f]{40}$/i.test(gitSha)) return gitSha.toLowerCase()
  } catch {
    // Local build without Git metadata. Production smoke will reject an unknown SHA.
  }
  return 'unknown'
}

export default defineConfig({
  plugins: [
    {
      name: 'pomak-build-metadata',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ sha: buildSha() }) + '\n' })
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registruje se ručno u main.tsx, samo u pregledaču (ne u Android aplikaciji).
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      // Push and notification clicks (public/push-sw.js) inside the generated service worker.
      workbox: { importScripts: ['push-sw.js'] },
      manifest: {
        name: 'POMAK',
        short_name: 'POMAK',
        description: 'Tvoj trening. Tvoja ishrana. Tvoj napredak.',
        lang: 'sr-Latn',
        theme_color: '#141615',
        background_color: '#f2efe9',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { host: true, proxy: { '/api': { target: 'http://localhost:8001', changeOrigin: true } } },
})
