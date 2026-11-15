import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LanguageMenu } from '../../components/LanguageMenu'

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="pt-safe pb-safe flex min-h-full">
      <main className="relative mx-auto flex w-full max-w-md flex-col justify-center px-5 py-10">
        <div className="absolute right-5 top-4">
          <LanguageMenu />
        </div>
        <p className="text-4xl font-extrabold tracking-tight text-brand">POMAK</p>
        <p className="mt-1 text-muted">{t('common.tagline')}</p>
        <h1 className="mb-5 mt-8 text-2xl font-bold">{title}</h1>
        {children}
      </main>
    </div>
  )
}
