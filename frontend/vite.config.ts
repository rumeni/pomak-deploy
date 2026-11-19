import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function buildSha(): string {
  for (const candidate of [process.env.POMAK_RELEASE_SHA, process.env.VERCEL_GIT_COMMIT_SHA, process.env.GITHUB_SHA]) {
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

// Written by npm prebuild. It is derived from the actual worker, 3 cores and model,
// not from the app's release SHA. In local dev without a vendored model, OCR is unavailable.
function ocrAssetVersion(): string {
  try {
    const { version } = JSON.parse(readFileSync(new URL('./public/ocr/asset-version.json', import.meta.url), 'utf8')) as { version: string }
    if (/^[a-f0-9]{16}$/.test(version)) return version
  } catch {
    // npm run dev before OCR vendoring: the scanner will report an unavailable model.
  }
  return 'dev'
}

const ocrVersion = ocrAssetVersion()

export default defineConfig({
  define: { __POMAK_OCR_VERSION__: JSON.stringify(ocrVersion) },
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
      workbox: {
        importScripts: ['push-sw.js', 'ocr-sw.js'],
        // OCR is large and optional: never download it for users who do not scan.
        // After the first online scan, CacheFirst keeps the worker, selected LSTM core
        // and language model locally for later offline use.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
        globIgnores: ['ocr/**', '**/ocr/**'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        runtimeCaching: [{
          urlPattern: /\/ocr\/[a-f0-9]{16}\//,
          handler: 'CacheFirst',
          options: {
            cacheName: `pomak-ocr-${ocrVersion}`,
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: 8, maxAgeSeconds: 365 * 24 * 60 * 60 },
          },
        }],
      },
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
