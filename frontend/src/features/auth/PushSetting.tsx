import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, FormError } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { disablePush, enablePush, pushStatus, pushSupported, type PushConfig, type PushStatus } from '../../lib/push'

/** Notifications on this device: new messages, plan changes, the coach's instructions. */
export function PushSetting() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const supported = pushSupported()
  const config = useQuery({
    queryKey: ['push-config'],
    queryFn: async () => (await api.get<PushConfig & { devices: number }>('/push/config/')).data,
    enabled: supported,
  })
  const status = useQuery({
    queryKey: ['push-status', config.data?.web_public_key ?? null, config.data?.fcm ?? false],
    queryFn: () => pushStatus(config.data!),
    enabled: !!config.data,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!supported || config.isError) return null
  const state: PushStatus | undefined = status.data
  if (state === 'unavailable' || state === 'unsupported') return null

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = state === 'on' ? (await disablePush(), 'off') : await enablePush(config.data!)
      qc.setQueryData(['push-status', config.data?.web_public_key ?? null, config.data?.fcm ?? false], next)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-2">
      <p className="font-medium">{t('push.title')}</p>
      <p className="text-sm text-muted">{t('push.text')}</p>
      {state === 'denied' && <p className="text-sm text-danger">{t('push.denied')}</p>}
      <FormError message={error} />
      {state && state !== 'denied' && (
        <Button variant={state === 'on' ? 'secondary' : 'primary'} disabled={busy} onClick={() => void toggle()}>
          {busy ? t('common.saving') : state === 'on' ? t('push.turnOff') : t('push.turnOn')}
        </Button>
      )}
    </Card>
  )
}
