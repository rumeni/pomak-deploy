import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button, Card, Field, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { formatDecimal, getFormatLocale, parseDecimal, toISODate } from '../../lib/format'
import { StatsSections } from '../progress/StatsPage'
import { StatsLinksContext } from '../progress/statsLinks'
import { STATS_PERIODS, type StatsPeriod } from '../progress/stats'
import { planDate } from './plans'
import { isCollaborationChanged } from './access'
import { useClientGuard } from './guard'
import { useClientStats, useClientTargets, useSetClientTarget, type CoachTarget } from './reviewApi'

/** The client's statistics, as he sees them (minus what he does not share); workouts open the review. */
export function ClientStats({ clientId }: { clientId: string }) {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<StatsPeriod>('30')
  const stats = useClientStats(clientId, period)
  const guard = useClientGuard(clientId, stats, {
    key: ['coach-client-stats', clientId, period], redact: (d) => ({ ...d, readiness: [] }),
  })
  const links = { exercise: () => null, session: (id: string) => `/trener/klijenti/${clientId}/trening/${id}` }
  return (
    <section className="flex flex-col gap-3" aria-label={t('stats.title')}>
      <div className="flex gap-1.5" role="group" aria-label={t('stats.period')}>
        {STATS_PERIODS.map((p) => (
          <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}
            className={`min-h-11 flex-1 rounded-xl text-sm font-semibold ${period === p ? 'bg-brand text-white' : 'bg-card ring-1 ring-line'}`}>
            {t(`stats.period_${p}`)}
          </button>
        ))}
      </div>
      {stats.isLoading && <p className="text-muted">{t('common.loading')}</p>}
      {stats.isError && !stats.data && <FormError message={t('errors.loadFailed')} />}
      {stats.data && guard.state !== 'revoked' && (
        <StatsLinksContext.Provider value={links}>
          {/* Access changed since: no readiness until the statistics are read again. */}
          <StatsSections data={guard.state === 'stale' ? { ...stats.data, readiness: [] } : stats.data} />
        </StatsLinksContext.Provider>
      )}
    </section>
  )
}

/** Recent workouts, each opening its review (planned vs done, comments). */
export function WorkoutLinks({ clientId, workouts }: { clientId: string; workouts: { id: string; name: string; started_at: string }[] }) {
  const { t } = useTranslation()
  return (
    <Card title={t('coach.recentWorkouts')}>
      {workouts.length === 0 && <p className="text-muted">{t('coach.noWorkouts')}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {workouts.map((w) => (
          <li key={w.id}>
            <Link to={`/trener/klijenti/${clientId}/trening/${w.id}`} className="flex min-h-12 items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{w.name}</span>
                <span className="block text-xs text-muted">{new Date(w.started_at).toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </span>
              <span className="text-sm text-muted">{t('coachSpace.review.open')} ›</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function TargetLine({ target, label }: { target: CoachTarget; label: string }) {
  const { t } = useTranslation()
  const macros = [
    [t('nutrition.proteinShort'), target.protein_g], [t('nutrition.carbsShort'), target.carbs_g], [t('nutrition.fatShort'), target.fat_g],
  ] as const
  return (
    <div className="py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label} · {planDate(target.valid_from)}</p>
      <p className="text-xl font-bold tabular-nums">{formatDecimal(target.kcal)} <span className="text-sm font-medium text-muted">{t('target.kcalPerDay')}</span></p>
      <p className="text-sm tabular-nums">{macros.map(([l, v]) => `${l} ${v == null ? '–' : `${formatDecimal(v)} g`}`).join(' · ')}</p>
      <p className="text-xs text-muted">{t(`target.mode_${target.mode}`)}{target.note ? ` · „${target.note}“` : ''}</p>
    </div>
  )
}

const intOrNull = (text: string) => {
  if (!text.trim()) return null
  const n = parseDecimal(text)
  return n === null ? NaN : Math.round(n)
}

/** The client's calorie target; the coach sets one only when the client allowed it. */
export function ClientTargetPanel({ clientId }: { clientId: string }) {
  const { t } = useTranslation()
  const targets = useClientTargets(clientId)
  const guard = useClientGuard(clientId, targets, {
    key: ['coach-client-targets', clientId], redact: (d) => ({ ...d, current: null, next: null }),
  })
  const save = useSetClientTarget(clientId)
  const [form, setForm] = useState({ kcal: '', protein: '', carbs: '', fat: '', validFrom: toISODate(new Date()), note: '' })
  const [error, setError] = useState<string | null>(null)
  const today = toISODate(new Date())
  // Targets need a nutrition consent: nothing of them once access is gone or has changed since.
  const data = guard.state === 'ok' ? targets.data : undefined
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const kcal = intOrNull(form.kcal)
    const macros = [intOrNull(form.protein), intOrNull(form.carbs), intOrNull(form.fat)]
    if (kcal === null || Number.isNaN(kcal) || macros.some((m) => Number.isNaN(m))) return setError(t('coachSpace.target.invalid'))
    save.mutate(
      { connection_id: data!.access.connection_id, valid_from: form.validFrom, kcal, protein_g: macros[0], carbs_g: macros[1], fat_g: macros[2], note: form.note.trim() },
      { onSuccess: () => setForm((f) => ({ ...f, kcal: '', protein: '', carbs: '', fat: '', note: '' })) },
    )
  }
  return (
    <Card title={t('coachSpace.target.title')}>
      {(targets.isLoading || guard.state === 'stale') && <p className="text-muted">{t('common.loading')}</p>}
      {targets.isError && !data && <FormError message={t('errors.loadFailed')} />}
      {data && !data.allowed && <p className="text-muted">{t('coach.notShared')}</p>}
      {data?.allowed && (
        <>
          {data.current ? <TargetLine target={data.current} label={t('coachSpace.target.current')} /> : <p className="text-muted">{t('coachSpace.target.none')}</p>}
          {data.next && <TargetLine target={data.next} label={t('coachSpace.target.next')} />}
          {!data.can_set ? (
            <p className="mt-2 text-sm text-muted">{t('coachSpace.target.notAllowed')}</p>
          ) : (
            <form className="mt-3 flex flex-col gap-3 border-t border-line pt-3" onSubmit={submit} noValidate>
              <p className="text-sm font-semibold">{t('coachSpace.target.set')}</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="kcal" name="target-kcal" inputMode="numeric" value={form.kcal} onChange={(e) => setForm({ ...form, kcal: e.target.value })} />
                <Field label={`${t('nutrition.proteinShort')} (g)`} name="target-protein" inputMode="numeric" value={form.protein} onChange={(e) => setForm({ ...form, protein: e.target.value })} />
                <Field label={`${t('nutrition.carbsShort')} (g)`} name="target-carbs" inputMode="numeric" value={form.carbs} onChange={(e) => setForm({ ...form, carbs: e.target.value })} />
                <Field label={`${t('nutrition.fatShort')} (g)`} name="target-fat" inputMode="numeric" value={form.fat} onChange={(e) => setForm({ ...form, fat: e.target.value })} />
              </div>
              <Field label={t('coachSpace.plan.validFrom')} name="target-from" type="date" min={today} value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
              <Field label={`${t('coachSpace.target.note')} (${t('common.optional')})`} name="target-note" maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              <p className="text-xs text-muted">{t('coachSpace.target.hint')}</p>
              <FormError message={error ?? (isCollaborationChanged(save.error) ? t('coachSpace.collaborationChanged') : save.error ? errorMessage(save.error) : null)} />
              <Button disabled={save.isPending || !form.kcal.trim()}>{save.isPending ? t('common.saving') : t('coachSpace.target.save')}</Button>
              {save.isSuccess && <p role="status" className="text-sm text-brand-dark">{t('coachSpace.target.saved')}</p>}
            </form>
          )}
        </>
      )}
    </Card>
  )
}
