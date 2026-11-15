import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card } from '../../components/ui'

/**
 * Android dozvola za tačne alarme. Bez nje obaveštenje o kraju pauze može da zakasni kad je
 * telefon dugo zaključan. Korisnik je uključuje sam (aplikacija ne otvara podešavanja usred treninga).
 */
export function ExactAlarmSetting() {
  const { t } = useTranslation()
  const [state, setState] = useState<string | null>(null)

  const refresh = () =>
    LocalNotifications.checkExactNotificationSetting().then(
      (r) => setState(r.exact_alarm),
      () => setState(null),
    )

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const check = () =>
      LocalNotifications.checkExactNotificationSetting().then(
        (r) => setState(r.exact_alarm),
        () => setState(null),
      )
    void check()
    // Posle povratka iz podešavanja telefona prikaži novo stanje.
    const handle = App.addListener('resume', () => void check())
    return () => void handle.then((h) => h.remove())
  }, [])

  if (!Capacitor.isNativePlatform() || state === null) return null
  const granted = state === 'granted'

  return (
    <Card className="flex flex-col gap-2">
      <p className="font-medium">{t('profile.exactAlarmsTitle')}</p>
      <p className="text-sm text-muted">{granted ? t('profile.exactAlarmsOn') : t('profile.exactAlarmsOff')}</p>
      <Button
        variant="secondary"
        onClick={() => void LocalNotifications.changeExactNotificationSetting().then(refresh, refresh)}
      >
        {t('profile.exactAlarmsChange')}
      </Button>
    </Card>
  )
}
