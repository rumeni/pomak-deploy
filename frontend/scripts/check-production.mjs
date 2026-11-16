// Runs only after successful push-to-main CI. No credentials and no test user accounts.
// Do not accept an old healthy deployment: the web release must match GitHub's commit.
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'

const expected = process.env.EXPECTED_SHA
assert.match(expected ?? '', /^[a-f0-9]{40}$/i, 'EXPECTED_SHA must be the tested Git commit')
const web = 'https://pomak-web.vercel.app'
const api = 'https://pomak-api.vercel.app'

async function request(url) {
  return fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    headers: { 'Cache-Control': 'no-cache' },
  })
}

let releaseMatch = false
for (let attempt = 1; attempt <= 20; attempt++) {
  let detail = 'unavailable'
  try {
    const response = await request(web + '/build.json?ci=' + expected)
    if (response.ok) {
      const info = await response.json()
      detail = String(info.sha ?? 'missing')
      releaseMatch = detail.toLowerCase() === expected.toLowerCase()
    } else {
      detail = 'HTTP ' + response.status
    }
  } catch (error) {
    detail = String(error)
  }
  console.log('Web deployment ' + attempt + '/20: ' + detail)
  if (releaseMatch) break
  if (attempt < 20) await sleep(15000)
}
assert.ok(releaseMatch, 'Vercel web did not deploy commit ' + expected + '; check rate limits and deployment logs')

for (const [url, type] of [
  [web + '/prijava', 'html'],
  [api + '/api/health/', 'status'],
  [api + '/api/ready/', 'status'],
  [web + '/api/health/', 'status'],
]) {
  const response = await request(url)
  assert.equal(response.status, 200, url + ' returned HTTP ' + response.status)
  if (type === 'html') {
    assert.match(await response.text(), /<div id="root"><\/div>/, 'Web app shell not served at login URL')
  } else {
    const data = await response.json()
    assert.equal(data.status, 'ok', url + ' did not report healthy')
  }
  console.log('OK ' + url)
}
console.log('PASS production smoke: matching web SHA + anonymous API availability')
