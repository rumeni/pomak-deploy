// Real browser verification of generated POMAK service worker and offline navigation.
// Run after npm run build; requires a local playwright runtime and Chromium.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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

  await context.setOffline(true)
  const offlineResponse = await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
  assert.equal(offlineResponse?.status(), 200, 'Offline root navigation was not precached')
  const body = await page.locator('#root').innerText()
  assert.match(body, /POMAK/i, 'Offline page did not render the app')
  console.log('Offline root navigation renders POMAK')

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
  console.log('PASS: real Chromium offline PWA service-worker smoke')
} finally {
  await browser?.close()
  preview.kill('SIGTERM')
}
