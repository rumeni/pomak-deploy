/** Test-only Vite entry: exercise the real scanner source from a real browser.
 * Built into dist AFTER the production PWA build, never imported by the app.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { FoodScanner, type ScanResult } from '../src/features/nutrition/FoodScanner'
import { readNutritionLabel } from '../src/features/nutrition/scan'

declare global {
  interface Window {
    __pomakOcrSmoke?: {
      recognize: typeof readNutritionLabel
      mountScanner: (element: HTMLElement) => void
      uiResult: ScanResult | null
    }
  }
}

window.__pomakOcrSmoke = {
  recognize: readNutritionLabel,
  uiResult: null,
  mountScanner(element) {
    createRoot(element).render(createElement(FoodScanner, {
      onResult: result => { window.__pomakOcrSmoke!.uiResult = result },
    }))
  },
}
