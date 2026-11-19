// Real browser verification of generated POMAK service worker and offline navigation.
// Run after npm run build; requires a local playwright runtime and Chromium.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const port = 4173
const url = 'http://127.0.0.1:' + port
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
})
preview.stdout.on('data', chunk => process.stdout.write('preview: ' + chunk))
preview.stderr.on('data', chunk => process.stderr.write('preview: ' + chunk))
let browser

async function waitForPreview() {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (preview.exitCode !== null) throw new Error('Vite preview quit before it became available')
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // Preview is still booting.
    }
    await sleep(250)
  }
  throw new Error('Vite preview not reachable')
}

try {
  await waitForPreview()
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  const page = await context.newPage()
  page.on('pageerror', error => console.error('PAGE ERROR:', error.message))
  page.on('console', message => { if (message.type() === 'error') console.error('PAGE CONSOLE:', message.text()) })
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  // Photo-header language menus must remain reachable beyond the header
  // on narrow phones (regression for an overflow:hidden clipping bug).
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 640 })
    const result = await page.evaluate(() => {
      const header = document.createElement('header')
      header.className = 'page-header page-header--photo'
      Object.assign(header.style, {
        display: 'flex', position: 'fixed', top: '20px', left: '16px',
        width: 'calc(100% - 32px)', margin: '0', zIndex: '10000',
      })
      header.innerHTML = '<div><h1>Trening</h1></div><div style="position:relative;margin-left:auto"><button style="height:44px">SR</button><div data-menu-probe style="position:absolute;top:52px;right:0;width:140px;height:140px;background:white;z-index:40"></div></div>'
      document.body.append(header)
      const menu = header.querySelector('[data-menu-probe]')
      const rect = menu.getBoundingClientRect()
      const headerRect = header.getBoundingClientRect()
      const protrudes = rect.bottom > headerRect.bottom
      const clickable = document.elementFromPoint(rect.left + 8, rect.bottom - 8) === menu
      header.remove()
      return { protrudes, clickable }
    })
    assert.ok(result.protrudes, 'Menu test must extend beyond photo header')
    assert.ok(result.clickable, 'Mobile language popup clipped at ' + width + 'px')
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  console.log('Photo header dropdown remains visible at 320px and 390px')

  // Safari on iPhone relies on Apple-specific standalone metadata and PNG icon.
  const ios = await page.evaluate(() => ({
    capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content'),
    title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content'),
    icon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
  }))
  assert.deepEqual(ios, { capable: 'yes', title: 'POMAK', icon: '/apple-touch-icon.png' })
  const iconResponse = await fetch(url + ios.icon)
  assert.equal(iconResponse.status, 200, 'iOS home-screen icon must exist')
  assert.match(iconResponse.headers.get('content-type') ?? '', /image\/png/, 'iOS touch icon must be a PNG')

  const releaseResponse = await fetch(url + '/build.json')
  assert.equal(releaseResponse.status, 200, 'Built web release metadata missing')
  assert.match((await releaseResponse.json()).sha, /^[a-f0-9]{40}$/, 'Build SHA must be a commit')

  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false
    return (await navigator.serviceWorker.getRegistrations()).length > 0
  }, null, { timeout: 15000 })
  await page.evaluate(async () => {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not activate after registration')), 15000)),
    ])
  })
  // The first navigation installs the SW; the second is controlled by it.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 15000 })

  const swUrl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)
  assert.ok(swUrl?.endsWith('/sw.js'), 'Unexpected service worker: ' + swUrl)
  console.log('Service worker controls the online page:', swUrl)

  const cores = (await readdir('dist/ocr/core')).sort()
  assert.deepEqual(cores, [
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js',
  ], 'Build must ship ONLY the three LSTM-embedded WASM cores')

  // Optional OCR must not be in the installation precache or runtime cache yet.
  const precachedOcr = await page.evaluate(async () => {
    const urls = []
    for (const name of await caches.keys()) {
      const entries = await (await caches.open(name)).keys()
      for (const entry of entries) {
        if (new URL(entry.url).pathname.startsWith('/ocr/')) urls.push(entry.url)
      }
    }
    return urls
  })
  assert.deepEqual(precachedOcr, [], 'First visit must not precache large OCR assets')

  await context.setOffline(true)
  const offlineResponse = await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
  assert.equal(offlineResponse?.status(), 200, 'Offline root navigation was not precached')
  const body = await page.locator('#root').innerText()
  assert.match(body, /POMAK/i, 'Offline page did not render the app')
  console.log('Offline root navigation renders POMAK')

  // Scanner assets are intentionally NOT available before the first online scan.
  // Normal PWA navigation remains offline-ready without paying for optional OCR.
  // SPA fallback must work when navigating to a deep link with no network.
  const routeResponse = await page.goto(url + '/trener', { waitUntil: 'domcontentloaded', timeout: 15000 })
  assert.equal(routeResponse?.status(), 200, 'Offline SPA route did not resolve')
  // A visible #root alone is not enough: index.html renders this empty element
  // even if JavaScript fails. Require actual React-rendered text while offline.
  await page.waitForFunction(
    () => /POMAK/i.test(document.querySelector('#root')?.textContent ?? ''),
    null,
    { timeout: 15000 },
  )
  const deepLinkText = await page.locator('#root').innerText()
  assert.match(deepLinkText, /POMAK/i, 'Offline SPA deep link did not render React content')
  console.log('Offline /trener deep link renders POMAK React content')

  await context.setOffline(false)

  // Simulate the first scan requesting OCR assets. The Workbox CacheFirst runtime
  // route caches each same-origin asset; a second scan must work offline.
  const ocrPaths = [
    '/ocr/worker.min.js',
    '/ocr/core/tesseract-core-lstm.wasm.js',
    '/ocr/core/tesseract-core-simd-lstm.wasm.js',
    '/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js',
    '/ocr/lang/hrv.traineddata.gz',
  ]
  const fetchOcrAssets = () => page.evaluate(async paths => Promise.all(paths.map(async path => {
    try {
      const response = await fetch(path)
      return { path, status: response.status, bytes: (await response.arrayBuffer()).byteLength }
    } catch (error) {
      return { path, error: String(error) }
    }
  })), ocrPaths)
  const firstScan = await fetchOcrAssets()
  for (const resource of firstScan) {
    assert.equal(resource.status, 200, 'First online OCR asset missing: ' + JSON.stringify(resource))
    assert.ok(resource.bytes > 100, 'OCR asset is empty: ' + resource.path)
  }

  const ocrCache = await page.evaluate(async () => {
    const cache = await caches.open('pomak-ocr-v1')
    return (await cache.keys()).map(request => new URL(request.url).pathname)
  })
  for (const path of ocrPaths) assert.ok(ocrCache.includes(path), 'OCR asset not runtime-cached: ' + path)

  await context.setOffline(true)
  const secondScan = await fetchOcrAssets()
  assert.deepEqual(secondScan, firstScan, 'Previously loaded OCR assets must work fully offline')
  await context.setOffline(false)
  console.log('PASS: offline PWA without OCR precache; OCR assets cached on demand and work offline')
} finally {
  await browser?.close()
  preview.kill('SIGTERM')
}
