import { useTranslation } from 'react-i18next'

import type { BookingStatus } from './api'

const STYLE: Record<BookingStatus, string> = {
  requested: 'bg-accent/20 text-ink',
  confirmed: 'bg-brand-soft text-brand-dark',
  declined: 'bg-line text-muted',
  cancelled: 'bg-line text-muted',
}

export function BookingStatusChip({ status }: { status: BookingStatus }) {
  const { t } = useTranslation()
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLE[status]}`}>{t(`schedule.status.${status}`)}</span>
}
