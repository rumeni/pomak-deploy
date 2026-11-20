import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { currentTheme, setTheme, subscribeTheme, THEMES } from '../../lib/theme'

/** Minimal per-device theme selector: the navigation dock remains unchanged. */
export function ThemeSetting() {
  const { t } = useTranslation()
  const selected = useSyncExternalStore(subscribeTheme, currentTheme, () => 'original')
  const labels = {
    original: t('profile.themeOriginal'),
    light: t('profile.themeLight'),
    blue: t('profile.themeBlue'),
  }

  return (
    <section className="rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-line/60" aria-label={t('profile.themeTitle')}>
      <p className="mb-3 font-medium">{t('profile.themeTitle')}</p>
      <div role="group" aria-label={t('profile.themeTitle')} className="flex gap-2">
        {THEMES.map((theme) => (
          <button
            key={theme}
            type="button"
            aria-pressed={selected === theme}
            onClick={() => setTheme(theme)}
            className={`min-h-11 min-w-0 flex-1 rounded-xl border px-2 text-sm font-semibold transition-colors ${selected === theme
              ? 'border-accent bg-brand-soft text-ink'
              : 'border-line bg-card text-muted'}`}
          >
            {labels[theme]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{t('profile.themeDeviceNote')}</p>
    </section>
  )
}
