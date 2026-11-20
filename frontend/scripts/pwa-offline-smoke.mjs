// Real browser verification of generated POMAK service worker and offline navigation.
// Run after npm run build; requires a local playwright runtime and Chromium.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { build as viteBuild } from 'vite'
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
  const { version: ocrVersion } = JSON.parse(await readFile('dist/ocr/asset-version.json', 'utf8'))
  assert.match(ocrVersion, /^[a-f0-9]{16}$/, 'OCR version must be a deterministic asset fingerprint')
  // Compile an isolated test-only entry from the SAME real scanner source. Do this
  // AFTER the app PWA build so the harness never adds bytes to the app/precache/APK.
  await viteBuild({
    configFile: false,
    root: process.cwd(),
    base: '/',
    define: { __POMAK_OCR_VERSION__: JSON.stringify(ocrVersion) },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      minify: true,
      rollupOptions: {
        input: 'scripts/ocr-smoke-entry.ts',
        output: {
          entryFileNames: '__ocr-browser-smoke.js',
          chunkFileNames: '__ocr-smoke-[name]-[hash].js',
          assetFileNames: '__ocr-smoke-[name]-[hash][extname]',
        },
      },
    },
  })
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
  // Real compiled CSS on narrow phone viewports: all five tab targets
  // must remain distinct, aligned and tappable in BOTH appearance modes.
  // The dock itself must not change appearance when the system mode flips.
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 700 })
    const navResult = await page.evaluate(() => {
      const host = document.createElement('nav')
      host.className = 'app-nav'
      host.setAttribute('aria-label', 'POMAK navigation CSS probe')
      host.innerHTML = '<ul class="app-nav-list" style="--dock-count:5">'
        + '<li class="app-nav-glider" aria-hidden="true"></li>'
        + ['Danas', 'Trening', 'Ishrana', 'Napredak', 'Trener'].map((title, i) =>
          '<li><a class="app-nav-link' + (i === 4 ? ' is-active' : '') + '" href="#tab">'
          + '<svg viewBox="0 0 24 24"><path d="M1 1L23 23"></path></svg>'
          + '<span>' + title + '</span></a></li>',
        ).join('') + '</ul>'
      document.body.append(host)
      const readings = []
      for (const mode of ['light', 'dark']) {
        document.documentElement.dataset.pomakMode = mode
        const navRect = host.getBoundingClientRect()
        const links = [...host.querySelectorAll('.app-nav-link')]
        const sizes = links.map(link => {
          const rect = link.getBoundingClientRect()
          return { left: rect.left, right: rect.right, width: rect.width,
            tappable: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('.app-nav-link') === link }
        })
        const glider = host.querySelector('.app-nav-glider')
        const gliderStyle = getComputedStyle(glider)
        const dockStyle = getComputedStyle(host)
        readings.push({
          mode, navBackground: dockStyle.backgroundColor,
          navAlpha: Number(dockStyle.backgroundColor.split(',').at(-1)?.replace(')', '').trim() ?? 1),
          activeColor: getComputedStyle(links[4]).color,
          gliderBorder: gliderStyle.borderTopWidth,
          gliderShadow: gliderStyle.boxShadow,
          gliderAlpha: Number(gliderStyle.backgroundColor.split(',').at(-1)?.replace(')', '').trim() ?? 1),
          cardColor: getComputedStyle(document.documentElement).getPropertyValue('--color-card').trim(),
          inside: sizes.every(item => item.left >= navRect.left - .5 && item.right <= navRect.right + .5),
          separate: sizes.every((item, i) => item.width >= 42 && (i === 0 || item.left >= sizes[i-1].right - .5)),
          tappable: sizes.every(item => item.tappable),
          width: navRect.width,
        })
      }
      host.remove()
      delete document.documentElement.dataset.pomakMode
      return readings
    })
    for (const state of navResult) {
      assert.ok(state.inside && state.separate && state.tappable, 'Mobile dock layout broke at ' + width + 'px, ' + state.mode + ': ' + JSON.stringify(state))
      assert.equal(state.activeColor, 'rgb(255, 90, 31)', 'Selected tab lost Pomak orange')
      assert.equal(state.gliderBorder, '0px', 'Active tab acquired a second outline')
      assert.equal(state.gliderShadow, 'none', 'Active tab acquired a second shadow')
      assert.ok(state.navAlpha < .6, 'Dock became too opaque: ' + state.navAlpha)
      assert.ok(state.gliderAlpha < .35, 'Active tab became too opaque: ' + state.gliderAlpha)
    }
    assert.equal(navResult[0].navBackground, navResult[1].navBackground, 'Switching theme must not change dock colour')
    assert.equal(navResult[1].cardColor, '#212223', 'Dark cards should stay neutral charcoal, not blue')
  }
  console.log('Mobile dock tabs fit and stay tappable at 320px/390px/430px in Light and Dark')

  // Codex P2 regressions: ink token becomes a light foreground in Dark mode,
  // but photo/Today hero panels and the desktop sidebar must remain DARK.
  await page.setViewportSize({ width: 1024, height: 720 })
  await page.evaluate(() => { document.documentElement.dataset.pomakMode = 'dark' })
  const darkPanelColors = await page.evaluate(() => {
    const selectors = ['today-hero', 'page-header--photo', 'app-nav']
    const nodes = selectors.map(className => {
      const el = document.createElement('div')
      el.className = className
      document.body.append(el)
      return el
    })
    const colors = nodes.map(node => getComputedStyle(node).backgroundColor)
    nodes.forEach(node => node.remove())
    return colors
  })
  assert.deepEqual(darkPanelColors, ['rgb(20, 22, 21)', 'rgb(20, 22, 21)', 'rgb(20, 22, 21)'],
    'White text on photo/hero/desktop nav must retain a dark background')

  // Codex P2: after an animated tab transition, an inline fixed descendant
  // must be viewport-fixed, not stuck in a permanent transformed ancestor.
  await page.setViewportSize({ width: 390, height: 720 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const tabAnimationResult = await page.evaluate(async () => {
    const outcomes = []
    for (const direction of ['app-tab-enter-next', 'app-tab-enter-prev']) {
      const wrapper = document.createElement('div')
      wrapper.className = direction
      wrapper.style.marginTop = '120px'
      const fixed = document.createElement('div')
      fixed.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px'
      wrapper.append(fixed)
      document.body.append(wrapper)
      await new Promise(resolve => setTimeout(resolve, 330))
      outcomes.push({
        transform: getComputedStyle(wrapper).transform,
        fixedTop: fixed.getBoundingClientRect().top,
      })
      wrapper.remove()
    }
    return outcomes
  })
  for (const result of tabAnimationResult) {
    assert.equal(result.transform, 'none', 'Tab animation leaves a transformed ancestor after completion')
    assert.ok(Math.abs(result.fixedTop) < 1, 'Fixed bottom sheets must stay viewport relative after tab switch')
  }
  await page.evaluate(() => { delete document.documentElement.dataset.pomakMode })
  console.log('Codex P2: dark hero contrast and post-animation fixed positioning verified')

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

  const cores = (await readdir('dist/ocr/' + ocrVersion + '/core')).sort()
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

  // Execute the ACTUAL scanner source in Chromium. A synthetic, high-contrast
  // Croatian nutrition label is generated in-browser; no photo upload occurs.
  await page.addScriptTag({ url: '/__ocr-browser-smoke.js', type: 'module' })
  await page.waitForFunction(() => !!window.__pomakOcrSmoke, null, { timeout: 20_000 })
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1700
    canvas.height = 1100
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'black'
    ctx.font = 'bold 76px Arial'
    const lines = [
      'NUTRITIVNA VRIJEDNOST 100 g',
      'ENERGIJA 100 kcal',
      'PROTEINI 12 g',
      'UGLJIKOHIDRATI 20 g',
      'MASTI 5 g',
      'VLAKNA 3 g',
    ]
    lines.forEach((line, index) => ctx.fillText(line, 50, 130 + index * 145))
    window.__ocrSample = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  })

  // Before any online scan, a fully offline user must get the existing visible
  // "scan.labelOffline" form fallback quickly, without a hanging OCR worker.
  await page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'ocr-offline-ui-smoke'
    document.body.append(host)
    window.__pomakOcrSmoke.mountScanner(host)
  })
  await page.waitForSelector('#ocr-offline-ui-smoke input[type="file"]', { state: 'attached' })
  await context.setOffline(true)
  await page.evaluate(() => {
    const inputs = document.querySelectorAll('#ocr-offline-ui-smoke input[type="file"]')
    const data = new DataTransfer()
    data.items.add(new File([window.__ocrSample], 'test-label.png', { type: 'image/png' }))
    inputs[1].files = data.files
    inputs[1].dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForFunction(() => window.__pomakOcrSmoke.uiResult !== null, null, { timeout: 12_000 })
  const offlineFallback = await page.evaluate(() => window.__pomakOcrSmoke.uiResult)
  assert.equal(offlineFallback.kind, 'label')
  assert.deepEqual(offlineFallback.values, {}, 'First offline scan must not invent values')
  assert.match(offlineFallback.note ?? '', /offline|internet|mrež/i, 'Offline scanner must show a clear fallback')
  assert.equal(await page.locator('#ocr-offline-ui-smoke button:not([disabled])').count(), 2,
    'Barcode/manual form actions must remain available after OCR failure')
  console.log('First-ever offline OCR reports a bounded error and keeps other actions available')
  await context.setOffline(false)

  const recognize = () => page.evaluate(async () => {
    return await Promise.race([
      window.__pomakOcrSmoke.recognize(window.__ocrSample).then(result => ({ text: result.text, found: result.found })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Real Chromium OCR recognition timed out')), 85_000)),
    ])
  })
  const online = await recognize()
  assert.match(online.text, /PROTEIN|MASTI|KCAL/i, 'Tesseract must read text from the synthetic label')
  console.log('Actual Croatian Tesseract worker recognized a synthetic label online')

  const ocrCache = await page.evaluate(async cacheName => {
    const cache = await caches.open(cacheName)
    return (await cache.keys()).map(request => new URL(request.url).pathname)
  }, 'pomak-ocr-' + ocrVersion)
  assert.ok(ocrCache.includes('/ocr/' + ocrVersion + '/worker.min.js'),
    'Real OCR worker did not populate versioned CacheFirst cache')
  assert.ok(ocrCache.includes('/ocr/' + ocrVersion + '/lang/hrv.traineddata.gz'),
    'Real OCR language model did not populate versioned CacheFirst cache')
  assert.ok(ocrCache.some(path => /\/ocr\/[a-f0-9]{16}\/core\/tesseract-core-.*\.wasm\.js$/.test(path)),
    'Real OCR core not cached after recognition')

  await context.setOffline(true)
  const offline = await recognize()
  assert.match(offline.text, /PROTEIN|MASTI|KCAL/i, 'Tesseract must recognize a label offline AFTER the first online scan')
  await context.setOffline(false)
  console.log('PASS: actual Tesseract recognition online/offline, first-offline UI fallback, and lazy versioned OCR cache')

} finally {
  await browser?.close()
  preview.kill('SIGTERM')
}
