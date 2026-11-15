import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { changeLanguage, LANGUAGES, toServerLanguage, type Language } from '../i18n'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Me } from '../lib/types'

// Naziv jezika je uvek na tom jeziku, da ga prepozna i neko ko ne razume trenutni jezik aplikacije.
const NATIVE: Record<Language, string> = { 'sr-Latn': 'Srpski', en: 'English' }
const CODE: Record<Language, string> = { 'sr-Latn': 'SR', en: 'EN' }

/**
 * Izbor jezika: globus sa oznakom (SR/EN) u zaglavlju ili red u Profilu. Promena je trenutna;
 * prijavljenom korisniku se pamti i na nalogu (važi na svim uređajima).
 */
export function LanguageMenu({ variant = 'icon' }: { variant?: 'icon' | 'row' }) {
  const { t, i18n } = useTranslation()
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const current = (LANGUAGES.includes(i18n.language as Language) ? i18n.language : 'sr-Latn') as Language

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 2000)
    return () => clearTimeout(id)
  }, [notice])

  const choose = async (language: Language) => {
    setOpen(false)
    if (language === current) return
    await changeLanguage(language)
    setNotice(`${i18n.t('language.label')}: ${NATIVE[language]}`)
    if (me) {
      try {
        const { data } = await api.patch<Me>('/auth/me/', { profile: { language: toServerLanguage(language) } })
        queryClient.setQueryData(['me'], data)
      } catch {
        // Bez interneta jezik važi na ovom telefonu; na nalogu se promeni sledeći put.
      }
    }
    // Nazivi vežbi i namirnica i poruke sa servera zavise od jezika.
    await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
  }

  const label = `${t('language.label')}: ${NATIVE[current]}`
  return (
    <div ref={root} className={variant === 'row' ? 'relative' : 'relative shrink-0'}>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          className="flex min-h-11 items-center gap-1.5 rounded-full bg-card px-3 text-sm font-semibold text-brand-dark ring-1 ring-line active:bg-brand-soft"
        >
          <GlobeIcon />
          {CODE[current]}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-card px-4 text-left font-medium shadow-sm ring-1 ring-line/60 active:bg-brand-soft"
        >
          <GlobeIcon />
          <span className="flex-1">{t('language.label')}</span>
          <span className="text-muted">{NATIVE[current]}</span>
          <span aria-hidden className="text-muted">
            ›
          </span>
        </button>
      )}

      {open && (
        <div
          role="menu"
          aria-label="Jezik / Language"
          className={`absolute z-40 mt-2 min-w-48 overflow-hidden rounded-2xl bg-card py-1 shadow-lg ring-1 ring-line ${variant === 'row' ? 'right-0 left-0' : 'right-0'}`}
        >
          <p className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">Jezik / Language</p>
          {LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={l === current}
              lang={l}
              onClick={() => void choose(l)}
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left active:bg-brand-soft"
            >
              <span className="w-4 text-brand" aria-hidden>
                {l === current ? '✓' : ''}
              </span>
              <span className={l === current ? 'font-semibold' : ''}>{NATIVE[l]}</span>
            </button>
          ))}
        </div>
      )}

      {notice && (
        <p role="status" className="pb-safe pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
          <span className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white shadow-lg">{notice}</span>
        </p>
      )}
    </div>
  )
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </svg>
  )
}
