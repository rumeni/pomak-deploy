/**
 * Build-vendored same-origin OCR: only 3 embedded LSTM core variants.
 * Keep all assets under a deterministic CONTENT fingerprint directory, so an
 * updated worker/core/model never mixes with a previous CacheFirst version.
 * No CDN or GitHub calls occur at runtime.
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'public', 'ocr')
const workerPath = join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js')
const core = join(root, 'node_modules', 'tesseract.js-core')
const languageCommit = '65727574dfcd264acbb0c3e07860e4e9e9b22185'
const expectedBlob = '6dd4f8638a58eb0663e8f9a80a355c505dcf01a6'

const engines = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
]
const installed = new Set(await readdir(core))
for (const file of engines) {
  if (!installed.has(file)) throw Error(`Required LSTM core variant missing: ${file}`)
}

const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${languageCommit}/hrv.traineddata`
const response = await fetch(url, { signal: AbortSignal.timeout(45_000) })
if (!response.ok) throw Error(`OCR model download failed: HTTP ${response.status}`)
const body = Buffer.from(await response.arrayBuffer())
const blobHash = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex')
if (blobHash !== expectedBlob) throw Error('Croatian OCR model integrity check failed')

const files = new Map([
  ['worker.min.js', await readFile(workerPath)],
  ...await Promise.all(engines.map(async name => [`core/${name}`, await readFile(join(core, name))])),
  ['lang/hrv.traineddata.gz', gzipSync(body, { level: 9 })],
])
// Stable across unrelated app releases; changes if ANY OCR byte changes.
const fingerprint = createHash('sha256')
for (const [name, bytes] of files) fingerprint.update(name).update('\0').update(bytes)
const version = fingerprint.digest('hex').slice(0, 16)

// Remove previous generated versions BEFORE copying, so Android never packages both.
await rm(output, { recursive: true, force: true })
const versioned = join(output, version)
await mkdir(join(versioned, 'core'), { recursive: true })
await mkdir(join(versioned, 'lang'), { recursive: true })
for (const [name, bytes] of files) await writeFile(join(versioned, name), bytes)
await writeFile(join(output, 'asset-version.json'), JSON.stringify({ version }) + '\n')

// Imported by the generated PWA SW. Delete obsolete OCR runtime cache generations
// when the NEW SW activates; never delete the current generation.
await writeFile(join(root, 'public', 'ocr-sw.js'), `/* Generated from content-fingerprinted OCR assets by vendor-ocr.mjs. */
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith('pomak-ocr-') && name !== 'pomak-ocr-${version}')
      .map(name => caches.delete(name)),
  )))
})
`)

console.log(`OCR assets vendored: ${engines.length} LSTM cores, Croatian model ${body.length} bytes, version ${version}`)
