import { useTranslation } from 'react-i18next'

import { useAuth } from '../../lib/auth'
import { setProgramsHidden, useProgramsHidden } from './programsPref'

/** Profil → Podešavanja: show or hide the suggested programs on the training screen. */
export function ProgramsSetting() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const hidden = useProgramsHidden(me?.id)
  if (!me) return null
  const on = !hidden

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setProgramsHidden(me.id, on)}
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left shadow-sm ring-1 ring-line/60 active:bg-brand-soft"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{t('programs.settingLabel')}</span>
        <span className="block text-sm text-muted">{t('programs.settingText')}</span>
      </span>
      <span
        aria-hidden
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-brand' : 'bg-line'}`}
      >
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  )
}
