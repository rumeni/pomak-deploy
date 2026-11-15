// Real browser verification of generated POMAK service worker and offline navigation.
// Run after npm run build; requires a local playwright runtime and Chromium.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const port = 4173
const url = 'http://127.0.0.1:' + port
const preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
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
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => 'serviceWorker' in navigator, { timeout: 15000 })
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
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
  assert.ok(await page.locator('#root').isVisible(), 'Offline SPA route is blank')
  console.log('Offline /trener deep link renders')

  await context.setOffline(false)
  console.log('PASS: real Chromium offline PWA service-worker smoke')
} finally {
  await browser?.close()
  preview.kill('SIGTERM')
}
