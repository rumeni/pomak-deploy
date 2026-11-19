import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button, Card, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useBookingAction, useMyBookings, type Booking } from './api'
import { BookingStatusChip } from './BookingStatusChip'
import { dayKey, dayLabel, timeLabel } from './time'

/** The client's upcoming sessions with the coach, and the way to book one. */
export function MyBookingsCard() {
  const { t } = useTranslation()
  const mine = useMyBookings()
  const upcoming = mine.data?.upcoming ?? []
  return (
    <Card title={t('schedule.mine.title')}>
      {mine.isLoading && <p className="text-sm text-muted">{t('common.loading')}</p>}
      {mine.isError && !mine.data && <FormError message={t('errors.loadFailed')} />}
      {mine.data && upcoming.length === 0 && <p className="text-sm text-muted">{t('schedule.mine.none')}</p>}
      <ul className="flex flex-col gap-2">
        {upcoming.map((b) => <MyBookingRow key={b.id} booking={b} />)}
      </ul>
      <Link to="/trener/termin" className="app-button mt-3 inline-flex min-h-11 w-full items-center justify-center bg-brand px-4 text-white">
        {t('schedule.mine.book')}
      </Link>
    </Card>
  )
}

function MyBookingRow({ booking }: { booking: Booking }) {
  const { t } = useTranslation()
  const action = useBookingAction()
  const cancel = () => {
    if (window.confirm(t('schedule.mine.cancelConfirm'))) action.mutate({ id: booking.id, action: 'cancel' })
  }
  const inactive = booking.status === 'cancelled' || booking.status === 'declined'
  return (
    <li className={`rounded-xl border border-line px-3 py-2 ${inactive ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold capitalize">{dayLabel(dayKey(booking.starts_at))}, {timeLabel(booking.starts_at)}</span>
        <BookingStatusChip status={booking.status} />
      </div>
      <p className="text-sm text-muted">{booking.session_type.name}</p>
      {booking.cancel_reason && <p className="text-xs text-muted">{booking.cancel_reason}</p>}
      <FormError message={action.error ? errorMessage(action.error) : null} />
      {booking.can_cancel && (
        <Button size="sm" variant="ghost" className="mt-1 text-danger" disabled={action.isPending} onClick={cancel}>{t('schedule.cancel')}</Button>
      )}
      {!booking.can_cancel && booking.status === 'confirmed' && (
        <p className="mt-1 text-xs text-muted">{t('schedule.mine.tooLate')}</p>
      )}
    </li>
  )
}
