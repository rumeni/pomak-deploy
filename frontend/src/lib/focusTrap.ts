import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Where Tab should go inside a modal: wrap from the last element to the first (and back with
 * Shift+Tab), and pull focus back in if it is outside. Null means "let the browser move it".
 */
export function nextFocusTarget<T>(items: readonly T[], active: T | null, shift: boolean): T | null {
  if (!items.length) return null
  const index = active === null ? -1 : items.indexOf(active)
  if (index === -1) return shift ? items[items.length - 1] : items[0]
  if (shift && index === 0) return items[items.length - 1]
  if (!shift && index === items.length - 1) return items[0]
  return null
}

/**
 * Keeps keyboard focus inside a modal dialog while it is mounted: focuses `initial` (or the
 * first control) on open, wraps Tab / Shift+Tab, and returns focus to the trigger on close.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, initial?: () => HTMLElement | null) {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    ;(initial?.() ?? focusables()[0] ?? root).focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const target = nextFocusTarget(focusables(), active, e.shiftKey)
      if (target) {
        e.preventDefault()
        target.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (trigger?.isConnected) trigger.focus()
    }
    // Run once per open; `initial` is read only at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref])
}
