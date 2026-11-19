import { useTranslation } from 'react-i18next'

import type { BookingStatus } from './api'

const STYLE: Record<BookingStatus | 'expired', string> = {
  requested: 'bg-accent/20 text-ink',
  confirmed: 'bg-brand-soft text-brand-dark',
  declined: 'bg-line text-muted',
  cancelled: 'bg-line text-muted',
  expired: 'bg-line text-muted',
}

/** A request nobody answered before its time shows as expired. */
export function BookingStatusChip({ status, expired = false }: { status: BookingStatus; expired?: boolean }) {
  const { t } = useTranslation()
  const key = expired ? 'expired' : status
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLE[key]}`}>{t(`schedule.status.${key}`)}</span>
}
