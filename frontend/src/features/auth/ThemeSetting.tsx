import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { currentTheme, setTheme, subscribeTheme, THEMES } from '../../lib/theme'

/** Native-style appearance preference: follows iOS/Android while System is selected. */
export function ThemeSetting() {
  const { t } = useTranslation()
  const selected = useSyncExternalStore(subscribeTheme, currentTheme, () => 'system')
  const labels = {
    light: t('profile.themeLight'),
    dark: t('profile.themeDark'),
    system: t('profile.themeSystem'),
  }

  return (
    <section className="rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-line/60" aria-label={t('profile.themeTitle')}>
      <p className="mb-3 font-medium">{t('profile.themeTitle')}</p>
      <div role="group" aria-label={t('profile.themeTitle')} className="grid grid-cols-3 gap-2">
        {THEMES.map((theme) => (
          <button
            key={theme}
            type="button"
            aria-pressed={selected === theme}
            onClick={() => setTheme(theme)}
            className={`min-h-11 min-w-0 rounded-xl border px-1 text-[13px] font-semibold transition-colors ${selected === theme
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
