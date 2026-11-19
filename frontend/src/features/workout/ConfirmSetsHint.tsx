import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui'
import { confirmHintSeen, markConfirmHintSeen } from './confirmHint'

/** Shown until dismissed, once per account on this device: every set is confirmed by hand. */
export function ConfirmSetsHint({ ownerId }: { ownerId: string }) {
  const { t } = useTranslation()
  // Dismissed for this account only: another account on the device sees its own state.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  if (dismissedFor === ownerId || confirmHintSeen(ownerId)) return null
  return (
    <div role="note" className="flex items-start gap-3 rounded-2xl bg-accent/15 p-4">
      <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-muted/60 bg-card" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t('workout.confirmHintTitle')}</p>
        <p className="mt-0.5 text-sm text-muted">{t('workout.confirmHintText')}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => { markConfirmHintSeen(ownerId); setDismissedFor(ownerId) }}>
          {t('workout.confirmHintOk')}
        </Button>
      </div>
    </div>
  )
}
