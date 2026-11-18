import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Button, Card, FormError, LoadingScreen, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { WeekCoachComments } from '../coach/WorkoutCoachComments'
import { isCollaborationChanged } from '../coach/access'
import { useCoachDashboard } from '../coach/api'
import { WeekReport } from './WeekReport'
import { useSaveCheckIn, useWeekReview, type WeekCheckIn } from './weekApi'
import { canCheckIn, CHECKIN_SCALES, mondayFromParam, shiftWeek, thisMonday, weekLabel } from './weeks'

/** "Nedelja": the week's facts and the athlete's own look back at it (also without a coach). */
export function WeekPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { me } = useAuth()
  const monday = mondayFromParam(params.get('od'), new Date())
  const current = thisMonday(new Date())
  const review = useWeekReview(monday)
  const dashboard = useCoachDashboard()
  const coach = dashboard.data?.role === 'client' ? dashboard.data.connection : null
  const hasCoach = !!coach
  const go = (week: string) => setParams(week === current ? {} : { od: week }, { replace: true })

  return (
    <div className="min-h-full pb-12">
      <ScreenHeader title={t('week.title')} onBack={() => navigate('/napredak')} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={() => go(shiftWeek(monday, -1))} aria-label={t('week.previous')}>‹</Button>
          <p className="font-semibold">{weekLabel(monday)}</p>
          <Button size="sm" variant="ghost" disabled={monday >= current} onClick={() => go(shiftWeek(monday, 1))} aria-label={t('week.next')}>›</Button>
        </div>
        {review.isLoading && <LoadingScreen />}
        {review.isError && !review.data && <FormError message={t('errors.loadFailed')} />}
        {review.data && (
          <>
            <WeekReport review={review.data} />
            {canCheckIn(monday, current)
              ? <CheckInForm key={`${monday}:${coach?.id ?? ''}`} monday={monday} initial={review.data.check_in}
                  coach={coach ? { id: coach.id, name: coach.coach.name } : null} coachKnown={!!dashboard.data}
                  onCoachChanged={() => void dashboard.refetch()} />
              : <p className="text-sm text-muted">{t('week.tooOld')}</p>}
            {hasCoach && me && <WeekCoachComments weekStart={monday} selfId={me.id} />}
          </>
        )}
      </div>
    </div>
  )
}

const EMPTY: WeekCheckIn = { energy: null, progress: null, nutrition: null, satisfaction: null, hardest: '', notes: '' }

function CheckInForm({ monday, initial, coach, coachKnown, onCoachChanged }: {
  monday: string
  initial: WeekCheckIn | null
  /** The coach shown on this form (from the dashboard); the athlete decides whether he sees it. */
  coach: { id: string; name: string } | null
  coachKnown: boolean
  onCoachChanged: () => void
}) {
  const { t } = useTranslation()
  const save = useSaveCheckIn(monday)
  const hasCoach = !!coach
  const [answers, setAnswers] = useState<WeekCheckIn>(initial ?? EMPTY)
  const [share, setShare] = useState(() => (initial ? initial.shared_with_coach !== false : true))
  const scales = CHECKIN_SCALES.filter((f) => f !== 'satisfaction' || hasCoach)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const { energy, progress, nutrition, satisfaction } = answers
    save.mutate(
      { energy, progress, nutrition, satisfaction, hardest: answers.hardest.trim(), notes: answers.notes.trim(), share_with: coach && share ? coach.id : null },
      { onError: (error) => { if (isCollaborationChanged(error)) onCoachChanged() } },
    )
  }
  return (
    <Card title={t('week.checkInTitle')}>
      <p className="mb-3 text-sm text-muted">{hasCoach ? t('week.checkInCoachHint') : t('week.checkInHint')}</p>
      {hasCoach && initial && !initial.shared_with_coach && <p className="mb-3 text-sm">{t('week.privateUntilSaved')}</p>}
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {scales.map((field) => (
          <fieldset key={field}>
            <legend className="mb-1.5 text-sm font-medium">{t(`week.q.${field}`)}</legend>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" aria-pressed={answers[field] === value}
                  onClick={() => setAnswers((a) => ({ ...a, [field]: a[field] === value ? null : value }))}
                  className={`min-h-11 flex-1 rounded-xl border-2 text-sm font-semibold ${answers[field] === value ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line bg-card'}`}>
                  {value}
                </button>
              ))}
            </div>
            <p className="mt-1 flex justify-between text-xs text-muted"><span>{t('week.scaleLow')}</span><span>{t('week.scaleHigh')}</span></p>
          </fieldset>
        ))}
        {(['hardest', 'notes'] as const).map((field) => (
          <div key={field} className="flex flex-col gap-1.5">
            <label htmlFor={`checkin-${field}`} className="text-sm font-medium">{t(`week.q.${field}`)} ({t('common.optional')})</label>
            <textarea id={`checkin-${field}`} rows={field === 'notes' ? 3 : 2} maxLength={field === 'notes' ? 1000 : 500} value={answers[field]}
              onChange={(e) => setAnswers((a) => ({ ...a, [field]: e.target.value }))}
              className="w-full rounded-2xl border border-line bg-card p-3 outline-none focus:border-brand" />
          </div>
        ))}
        {coach && (
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="size-5 accent-brand" />
            {t('week.shareWith', { name: coach.name })}
          </label>
        )}
        <FormError message={isCollaborationChanged(save.error) ? t('week.coachChanged') : save.error ? errorMessage(save.error) : null} />
        <Button disabled={save.isPending || !coachKnown}>{save.isPending ? t('common.saving') : t('week.save')}</Button>
        {save.isSuccess && <p role="status" className="text-sm text-brand-dark">{t('week.saved')}</p>}
      </form>
    </Card>
  )
}
