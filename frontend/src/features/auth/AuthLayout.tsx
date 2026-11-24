import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LanguageMenu } from '../../components/LanguageMenu'

/**
 * `compact`: on phones skip the big headline so a long form (registration) starts at the top.
 * `fit`: on phones keep the headline but size everything to one screen (login, the start screen).
 */
export function AuthLayout({ title, compact = false, fit = false, children }: { title: string; compact?: boolean; fit?: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className={`auth-stage pt-safe pb-safe ${compact ? 'auth-stage--compact' : ''} ${fit ? 'auth-stage--fit' : ''}`}>
      <div className="topo-layer" aria-hidden />
      <aside className="auth-aside">
        <span className="brand-wordmark">POMAK</span>
        <p className="auth-aside-title">
          {t('common.tagline')
            .split(/(?<=\.)\s+/)
            .map((line) => (
              <span key={line} className="block">{line}</span>
            ))}
        </p>
        <p className="auth-aside-text">{t('common.authIntro')}</p>
      </aside>
      <main className="auth-panel relative">
        <div className="absolute right-5 top-5"><LanguageMenu /></div>
        <div className="auth-panel-brand" aria-hidden={!compact}>
          <span className="brand-wordmark text-ink">POMAK</span>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">{t('common.tagline')}</p>
        </div>
        <h1 className="auth-panel-title font-display mb-6 text-4xl uppercase">{title}</h1>
        {children}
      </main>
    </div>
  )
}
