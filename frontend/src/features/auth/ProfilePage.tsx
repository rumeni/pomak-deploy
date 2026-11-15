import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { LanguageMenu } from '../../components/LanguageMenu'
import { Button, Card, FormError, ScreenHeader } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { toISODate } from '../../lib/format'
import { saveFile } from '../../lib/saveFile'
import { ExactAlarmSetting } from '../workout/ExactAlarmSetting'
import { clearLocalData, unsentSummary } from '../workout/localData'
import { TrackingSetting } from './TrackingSetting'

/** Profil i podešavanja: jezik, obroci, cilj, izvoz podataka, brisanje naloga, odjava. */
export function ProfilePage() {
  const { me, logout } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Neposlati treninzi pripadaju ovom nalogu; posle odjave ih niko ne bi video ni poslao.
  const onLogout = async () => {
    if (me) {
      const { active, pending } = await unsentSummary(me.id)
      if (pending > 0 && !window.confirm(t('profile.logoutUnsent', { count: pending }))) return
      if (active && !window.confirm(t('profile.logoutActive'))) return
      await clearLocalData(me.id)
    }
    logout()
  }

  const onExport = async () => {
    setExportError(null)
    setExporting(true)
    try {
      const { data } = await api.get<Blob>('/auth/me/export/', { responseType: 'blob', timeout: 60_000 })
      await saveFile(data, `pomak-izvoz-${toISODate(new Date())}.zip`, t('profile.exportTitle'))
    } catch (e) {
      setExportError(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('profile.title')} onBack={() => navigate(-1)} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-4">
        <Card>
          <p className="font-semibold">{me?.profile.display_name || t('profile.noName')}</p>
          <p className="text-muted">{me?.email}</p>
        </Card>

        <h2 className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted">{t('profile.settings')}</h2>
        <LanguageMenu variant="row" />
        <Card>
          <TrackingSetting />
        </Card>
        <NavRow to="/profil/obroci">{t('profile.mealsLink')}</NavRow>
        <NavRow to="/ishrana/cilj">{t('profile.targetLink')}</NavRow>
        <ExactAlarmSetting />

        <h2 className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted">{t('profile.yourData')}</h2>
        <Card className="flex flex-col gap-2">
          <p className="font-medium">{t('profile.exportTitle')}</p>
          <p className="text-sm text-muted">{t('profile.exportText')}</p>
          <FormError message={exportError} />
          <Button variant="secondary" onClick={() => void onExport()} disabled={exporting}>
            {exporting ? t('profile.exporting') : t('profile.export')}
          </Button>
        </Card>

        <Card className="flex flex-col gap-1 text-sm">
          <p className="font-medium">{t('profile.sources')}</p>
          <p className="text-muted">{t('profile.sourceFoods')}</p>
          <p className="text-muted">
            {t('profile.sourceExercises')}{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" className="underline">
              CC BY-SA 4.0
            </a>
          </p>
        </Card>

        <Button variant="secondary" className="mt-2" onClick={() => void onLogout()}>
          {t('profile.logout')}
        </Button>
        <Link to="/profil/obrisi-nalog" className="flex min-h-12 items-center justify-center rounded-xl font-semibold text-danger active:bg-line">
          {t('profile.deleteAccount')}
        </Link>
      </div>
    </div>
  )
}

function NavRow({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-14 items-center justify-between rounded-2xl bg-card px-4 font-medium shadow-sm ring-1 ring-line/60 active:bg-brand-soft">
      {children}
      <span aria-hidden className="text-muted">
        ›
      </span>
    </Link>
  )
}
