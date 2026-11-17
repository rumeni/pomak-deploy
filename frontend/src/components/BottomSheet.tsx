import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useFocusTrap } from '../lib/focusTrap'

/**
 * Modal panel from the bottom of the screen. Closes on Escape, a tap outside or ✕; locks the
 * page scroll and keeps keyboard focus inside until it closes (then returns it to the trigger).
 */
export function BottomSheet({
  label,
  kicker,
  title,
  onClose,
  initialFocus,
  children,
}: {
  /** Accessible name of the dialog. */
  label: string
  /** Small line above the title (e.g. the exercise and set). */
  kicker?: string
  title: string
  onClose: () => void
  /** Element to focus first; the first control otherwise. */
  initialFocus?: (root: HTMLElement) => HTMLElement | null
  children: ReactNode
}) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLElement>(null)
  useFocusTrap(dialog, () => (dialog.current && initialFocus ? initialFocus(dialog.current) : null))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose} role="presentation">
      <section
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className="pb-safe max-h-[88vh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-3xl bg-surface p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {kicker && <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">{kicker}</p>}
            <h2 className="text-lg font-semibold">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-line">
            ✕
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}
