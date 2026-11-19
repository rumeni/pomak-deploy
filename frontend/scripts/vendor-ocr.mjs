/**
 * Vendor OCR assets as same-origin files before building the PWA or Android APK.
 * Tesseract's worker/WASM come from npm ci (locked package versions). The Croatian
 * tessdata_fast model is downloaded at build time from an immutable Git commit and
 * verified against its Git blob SHA, so no CDN or GitHub request occurs at runtime.
 */
import { createHash } from 'node:crypto'
import { mkdir, copyFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'public', 'ocr')
const worker = join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js')
const core = join(root, 'node_modules', 'tesseract.js-core')
const languageCommit = '65727574dfcd264acbb0c3e07860e4e9e9b22185'
const expectedBlob = '6dd4f8638a58eb0663e8f9a80a355c505dcf01a6'

// A previous build may have left the old 12 core variants in public/ocr.
// Clean generated files first so Vite and Capacitor never package stale WASM.
await rm(output, { recursive: true, force: true })
await mkdir(join(output, 'core'), { recursive: true })
await mkdir(join(output, 'lang'), { recursive: true })
await copyFile(worker, join(output, 'worker.min.js'))
// OEM 1 (LSTM) selects one of these variants at runtime, depending on SIMD support.
// The *.wasm.js wrappers embed the WASM; copying separate *.wasm binaries doubles it.
// Legacy (non-LSTM) variants are never selected by createWorker('hrv', 1).
const engines = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
]
const installed = new Set(await readdir(core))
for (const file of engines) {
  if (!installed.has(file)) throw Error(`Required LSTM core variant missing: ${file}`)
  await copyFile(join(core, file), join(output, 'core', file))
}

const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${languageCommit}/hrv.traineddata`
const response = await fetch(url, { signal: AbortSignal.timeout(45_000) })
if (!response.ok) throw Error(`OCR model download failed: HTTP ${response.status}`)
const body = Buffer.from(await response.arrayBuffer())
const blobHash = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex')
if (blobHash !== expectedBlob) throw Error('Croatian OCR model integrity check failed')
await writeFile(join(output, 'lang', 'hrv.traineddata.gz'), gzipSync(body, { level: 9 }))
console.log(`OCR assets vendored: ${engines.length} core files, Croatian model ${body.length} bytes`)
