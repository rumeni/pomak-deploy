import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LanguageMenu } from '../../components/LanguageMenu'

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="auth-stage pt-safe pb-safe">
      <main className="auth-panel relative">
        <div className="absolute right-6 top-6"><LanguageMenu /></div>
        <div className="auth-mark">
          <span className="auth-mark-icon" aria-hidden>P</span>
          <span className="text-2xl font-extrabold tracking-[-0.06em] text-ink">POMAK</span>
        </div>
        <p className="mt-5 max-w-xs text-sm leading-relaxed text-muted">{t('common.tagline')}</p>
        <h1 className="mb-6 mt-9 text-3xl font-extrabold tracking-[-0.045em]">{title}</h1>
        {children}
      </main>
    </div>
  )
}
