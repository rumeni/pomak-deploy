import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { Button, FormError, LoadingScreen, ScreenHeader } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { CheckInAnswers, WeekReport } from '../progress/WeekReport'
import { useClientWeek } from '../progress/weekApi'
import { mondayFromParam, shiftWeek, thisMonday, weekLabel } from '../progress/weeks'
import { CoachMessages } from './CoachMessages'

/** A client's week for the coach: the facts he shares, his check-in, and the comments on the week. */
export function ClientWeekPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { me } = useAuth()
  const monday = mondayFromParam(params.get('od'), new Date())
  const current = thisMonday(new Date())
  const week = useClientWeek(id, monday)
  const go = (value: string) => setParams(value === current ? {} : { od: value }, { replace: true })
  return (
    <div className="min-h-full pb-12">
      <ScreenHeader title={t('week.title')} onBack={() => navigate(`/trener/klijenti/${id}`)} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={() => go(shiftWeek(monday, -1))} aria-label={t('week.previous')}>‹</Button>
          <p className="font-semibold">{weekLabel(monday)}</p>
          <Button size="sm" variant="ghost" disabled={monday >= current} onClick={() => go(shiftWeek(monday, 1))} aria-label={t('week.next')}>›</Button>
        </div>
        {week.isLoading && <LoadingScreen />}
        {week.isError && !week.data && <FormError message={t('coachSpace.review.notFound')} />}
        {week.data && (
          <>
            <WeekReport review={week.data} forCoach />
            <CheckInAnswers checkIn={week.data.check_in} />
            {me && <CoachMessages selfId={me.id} clientId={id} weekStart={monday} title={t('coachSpace.week.comments')} />}
          </>
        )}
      </div>
    </div>
  )
}
