/**
 * Free, on-device reading of a package photo: the barcode (EAN/UPC) and the nutrition table.
 * Both libraries are loaded only when the athlete opens the camera, so they cost nothing
 * elsewhere in the app. No photo is uploaded.
 */
import { parseLabelText, type LabelValues } from './labelText'

const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

async function toCanvas(file: Blob, maxSide = 1600): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

/** Barcode digits from a photo, or null. Uses the browser's detector where it exists. */
export async function readBarcode(file: Blob): Promise<string | null> {
  const canvas = await toCanvas(file)
  const Detector = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector
  if (Detector) {
    try {
      const codes = await new Detector({ formats: BARCODE_FORMATS }).detect(canvas)
      const code = codes.map((c) => c.rawValue).find((v) => /^\d{8,14}$/.test(v))
      if (code) return code
    } catch {
      // Fall through to the JavaScript decoder.
    }
  }
  const zxing = await import('@zxing/library')
  const hints = new Map()
  hints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [
    zxing.BarcodeFormat.EAN_13, zxing.BarcodeFormat.EAN_8, zxing.BarcodeFormat.UPC_A, zxing.BarcodeFormat.UPC_E,
  ])
  hints.set(zxing.DecodeHintType.TRY_HARDER, true)
  const reader = new zxing.MultiFormatReader()
  reader.setHints(hints)
  try {
    const source = new zxing.HTMLCanvasElementLuminanceSource(canvas)
    const text = reader.decode(new zxing.BinaryBitmap(new zxing.HybridBinarizer(source))).getText()
    return /^\d{8,14}$/.test(text) ? text : null
  } catch {
    return null
  }
}

/**
 * Grey, high-contrast, black-on-white copy at a size the recogniser reads well. Package
 * photos have colour backgrounds, glare and table borders; thresholding around the image's
 * own mean brightness removes most of that.
 */
function prepareForText(source: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.max(1, 1800 / source.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(source.width * scale)
  canvas.height = Math.round(source.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = image.data
  let sum = 0
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
  const mean = sum / (px.length / 4)
  // Light text on a dark package: invert so the text is always dark.
  const invert = mean < 110
  const threshold = invert ? mean * 1.15 : mean * 0.85
  for (let i = 0; i < px.length; i += 4) {
    const grey = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    const dark = invert ? grey > threshold : grey < threshold
    px[i] = px[i + 1] = px[i + 2] = dark ? 0 : 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/**
 * Text recognition of the nutrition table, then the values per 100 g. `onProgress` gets 0-1.
 * OCR engine and language data are bundled with the app and precached for offline use.
 * Reads the photo as is and prepared (high contrast) and keeps whichever finds more values.
 */
export async function readNutritionLabel(file: Blob, onProgress?: (share: number) => void): Promise<LabelValues & { text: string }> {
  const canvas = await toCanvas(file, 2400)
  const { createWorker, PSM } = await import('tesseract.js')
  let pass = 0
  // Only same-origin, build-vendored OCR files: never execute CDN scripts in this app.
  const ocrBase = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.origin).href
  // Croatian model: Latin script with diacritics and decimal commas, like labels in the region.
  const worker = await createWorker('hrv', 1, {
    workerPath: `${ocrBase}worker.min.js`,
    corePath: `${ocrBase}core`,
    langPath: `${ocrBase}lang`,
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.((pass + m.progress) / 2)
    },
  })
  try {
    // One column of rows keeps each nutrient's name and numbers on one line.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: '1' })
    const attempts: (LabelValues & { text: string })[] = []
    for (const image of [canvas, prepareForText(canvas)]) {
      const { data } = await worker.recognize(image)
      attempts.push({ ...parseLabelText(data.text), text: data.text })
      pass += 1
      if (attempts[attempts.length - 1].found.length >= 5) break
    }
    return attempts.reduce((best, a) => (a.found.length > best.found.length ? a : best))
  } finally {
    await worker.terminate()
  }
}
