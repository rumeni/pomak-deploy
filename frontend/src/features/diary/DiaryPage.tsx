import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { Button, Card, PageHeader } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { addDays, formatDecimal, formatLongDate, fromISODate, toISODate } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { fmtValue } from '../nutrition/macroFormat'
import { useCreateSavedMeal } from './api'
import { mealLabel, mealSettings, visibleMeals } from './meals'
import { copyEntry, savedItemFromEntry, totals, type DayTotals, type DisplayDay, type MacroTotal } from './model'
import { discardRejectedDayOps, loadDayEntries, saveDrafts, setDayStatus, useDiaryDay } from './store'
import type { DayStatus, DayTarget, DiaryEntry, MealKey } from './types'
import { LanguageMenu } from '../../components/LanguageMenu'

/** Dnevnik hrane za jedan dan: obroci, zbir i status dana. Datum je u adresi (?datum=). */
export function DiaryPage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const [params, setParams] = useSearchParams()
  const today = toISODate(new Date())
  const date = params.get('datum') ?? today
  const { day, offline } = useDiaryDay(me?.id, date)
  const settings = mealSettings(me?.profile.meals)
  const [notice, setNotice] = useState<string | null>(null)

  const go = (n: number) => setParams({ datum: addDays(date, n) }, { replace: true })

  return (
    <>
      <PageHeader title={t('nutrition.title')} action={<LanguageMenu />} />
      <div className="flex flex-col gap-3 px-4">
        <div className="flex items-center justify-between rounded-2xl bg-card p-1 shadow-sm ring-1 ring-line/60">
          <NavButton label={t('diary.prevDay')} path="M15 18l-6-6 6-6" onClick={() => go(-1)} />
          <p className="text-center font-semibold">{dayLabel(date, today, t)}</p>
          <NavButton label={t('diary.nextDay')} path="M9 18l6-6-6-6" onClick={() => go(1)} />
        </div>

        {offline && <p className="rounded-xl bg-accent/15 px-4 py-2 text-sm">{t('diary.offline')}</p>}
        {notice && (
          <p role="status" className="rounded-xl bg-brand-soft px-4 py-2 text-sm text-brand-dark">
            {notice}
          </p>
        )}

        {day && (
          <>
            {day.errors.size > 0 && me && (
              <div role="alert" className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm">
                <p>{t('diary.rejectedChanges', { count: day.errors.size })}</p>
                {[...day.errors.entries()].map(([id, message]) => (
                  <p key={id} className="mt-1 text-muted">{message}</p>
                ))}
                <button type="button" className="mt-2 underline" onClick={() => void discardRejectedDayOps(me.id, date)}>
                  {t('diary.dismissRejected')}
                </button>
              </div>
            )}
            <TotalsCard totals={totals(day.entries)} target={day.target ?? null} past={date < toISODate(new Date())} />
            {visibleMeals(settings, day.entries).map((m) => (
              <MealCard key={m.key} date={date} meal={m.key} label={mealLabel(m.key, settings, t)} day={day} onNotice={setNotice} />
            ))}
            <StatusCard date={date} day={day} ownerId={me?.id} />
          </>
        )}

        <Link to="/ishrana/namirnice" className="py-3 text-center font-semibold text-brand-dark">
          {t('diary.foodsDb')} →
        </Link>
      </div>
    </>
  )
}

function dayLabel(date: string, today: string, t: (k: string) => string): string {
  if (date === today) return t('diary.today')
  if (date === addDays(today, -1)) return t('diary.yesterday')
  if (date === addDays(today, 1)) return t('diary.tomorrow')
  return formatLongDate(fromISODate(date))
}

function NavButton({ label, path, onClick }: { label: string; path: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex size-12 items-center justify-center rounded-xl active:bg-brand-soft">
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={path} />
      </svg>
    </button>
  )
}

/** Zbir dana i cilj. Razlika do cilja je neutralna: bez crvenog upozorenja za prekoračenje. */
function TotalsCard({ totals: tot, target, past }: { totals: DayTotals; target: DayTarget | null; past: boolean }) {
  const { t } = useTranslation()
  const macros: [string, MacroTotal, number | null][] = [
    [t('nutrition.protein'), tot.protein, target?.protein_g ?? null],
    [t('nutrition.carbs'), tot.carbs, target?.carbs_g ?? null],
    [t('nutrition.fat'), tot.fat, target?.fat_g ?? null],
  ]
  const anyUnknown = macros.some(([, m]) => m.unknown > 0)
  const diff = target ? target.kcal - tot.kcal : 0
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{t('diary.dayTotals')}</p>
        {(target || !past) && (
          <Link to="/ishrana/cilj" className="-my-2 flex min-h-11 items-center text-sm font-semibold text-brand-dark">
            {target ? t('diary.targetLink') : t('diary.setTarget')}
          </Link>
        )}
      </div>
      <p className="text-3xl font-bold tabular-nums">
        {tot.kcal}
        {target && <span className="text-xl font-semibold text-muted"> / {formatDecimal(target.kcal)}</span>}{' '}
        <span className="text-base font-medium text-muted">{t('nutrition.kcal')}</span>
      </p>
      {target && (
        <p className="text-sm text-muted tabular-nums">
          {diff >= 0 ? t('diary.remaining', { kcal: formatDecimal(diff) }) : t('diary.overTarget', { kcal: formatDecimal(-diff) })}
        </p>
      )}
      <dl className="mt-2 grid grid-cols-3 gap-2">
        {macros.map(([label, m, goal]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-semibold tabular-nums">
              {formatDecimal(m.value)}
              {goal !== null && <span className="font-normal text-muted"> / {formatDecimal(goal)}</span>} g
            </dd>
            {m.unknown > 0 && <dd className="text-xs text-muted">{t('diary.unknownMacro', { count: m.unknown })}</dd>}
          </div>
        ))}
      </dl>
      {anyUnknown && <p className="mt-2 text-xs text-muted">{t('diary.unknownNote')}</p>}
    </Card>
  )
}

function MealCard({
  date,
  meal,
  label,
  day,
  onNotice,
}: {
  date: string
  meal: MealKey
  label: string
  day: DisplayDay
  onNotice: (message: string) => void
}) {
  const { t } = useTranslation()
  const { me } = useAuth()
  const createSaved = useCreateSavedMeal()
  const [menuOpen, setMenuOpen] = useState(false)
  const entries = day.entries.filter((e) => e.meal === meal)
  const kcal = Math.round(entries.reduce((sum, e) => sum + Number(e.kcal), 0))

  // Kopira isti obrok od juče; kopiranje ne menja status dana.
  const copyYesterday = async () => {
    setMenuOpen(false)
    if (!me) return
    const source = (await loadDayEntries(me.id, addDays(date, -1))).filter((e) => e.meal === meal)
    if (!source.length) return onNotice(t('diary.copyNothing'))
    const now = new Date()
    await saveDrafts(me.id, source.map((e) => copyEntry(e, uuid(), date, meal, now)))
    onNotice(t('diary.copied', { count: source.length }))
  }

  const saveAsMeal = () => {
    setMenuOpen(false)
    const name = window.prompt(t('diary.saveAsMealPrompt'), label)?.trim()
    if (!name) return
    createSaved.mutate(
      { id: uuid(), name, items: entries.map(savedItemFromEntry) },
      { onSuccess: () => onNotice(t('diary.savedMealCreated', { name })) },
    )
  }
  return (
    <section className="rounded-2xl bg-card shadow-sm ring-1 ring-line/60">
      <div className="flex items-center justify-between gap-2 pl-4 pr-1 pt-1">
        <h2 className="flex-1 font-semibold text-brand-dark">{label}</h2>
        <span className="text-sm tabular-nums text-muted">
          {kcal} {t('nutrition.kcal')}
        </span>
        <button
          type="button"
          aria-label={t('diary.moreOptions')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="flex size-11 items-center justify-center rounded-full text-xl text-muted active:bg-line"
        >
          ⋯
        </button>
      </div>
      {menuOpen && (
        <div className="mx-4 mb-1 flex flex-col rounded-xl bg-surface ring-1 ring-line">
          <button type="button" onClick={() => void copyYesterday()} className="min-h-11 px-4 text-left font-medium active:bg-brand-soft">
            {t('diary.copyYesterday')}
          </button>
          {entries.length > 0 && (
            <button type="button" onClick={saveAsMeal} className="min-h-11 border-t border-line px-4 text-left font-medium active:bg-brand-soft">
              {t('diary.saveAsMeal')}
            </button>
          )}
        </div>
      )}
      <ul className="px-4">
        {entries.length === 0 && <li className="py-2 text-sm text-muted">{t('diary.emptyMeal')}</li>}
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} pending={day.pendingIds.has(entry.id)} error={day.errors.get(entry.id)} />
        ))}
      </ul>
      <Link
        to={`/ishrana/dodaj?datum=${date}&obrok=${meal}`}
        className="flex min-h-12 items-center justify-center rounded-b-2xl border-t border-line font-semibold text-brand-dark active:bg-brand-soft"
      >
        {t('diary.add')}
      </Link>
    </section>
  )
}

function EntryRow({ entry, pending, error }: { entry: DiaryEntry; pending: boolean; error?: string }) {
  const { t } = useTranslation()
  const amount = entry.portion_name || (entry.grams ? `${formatDecimal(Number(entry.grams))} g` : '')
  return (
    <li className="border-b border-line last:border-0">
      <Link to={`/ishrana/stavka?stavka=${entry.id}&datum=${entry.date}`} className="flex items-center gap-3 py-2.5 active:bg-brand-soft">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{entry.name}</span>
          <span className="block text-sm text-muted">
            {amount}
            {amount && ' · '}
            {t('nutrition.proteinShort')} {fmtValue(entry.protein_g)} · {t('nutrition.carbsShort')} {fmtValue(entry.carbs_g)} ·{' '}
            {t('nutrition.fatShort')} {fmtValue(entry.fat_g)}
          </span>
          {pending && !error && <span className="text-xs font-medium text-muted">{t('diary.pending')}</span>}
          {error && <span className="text-xs font-medium text-danger">{t('diary.rejected', { error })}</span>}
        </span>
        <span className="font-semibold tabular-nums">{Math.round(Number(entry.kcal))}</span>
      </Link>
    </li>
  )
}

function StatusCard({ date, day, ownerId }: { date: string; day: DisplayDay; ownerId: string | undefined }) {
  const { t } = useTranslation()
  // Dan bez unosa i bez oznake se jasno razlikuje od dana "u toku".
  const status: DayStatus | 'none' = day.status ?? (day.entries.length ? 'in_progress' : 'none')
  const set = (s: DayStatus) => ownerId && void setDayStatus(ownerId, date, s)

  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted">{t('diary.statusTitle')}</p>
        <span className="rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand-dark">{t(`diary.status_${status}`)}</span>
      </div>
      <p className="mt-2 text-sm text-muted">{t(status === 'complete' ? 'diary.completeDone' : 'diary.completeHint')}</p>
      <div className="mt-3 flex flex-col gap-2">
        {status !== 'complete' && <Button onClick={() => set('complete')}>{t('diary.markComplete')}</Button>}
        {status === 'in_progress' && (
          <Button variant="secondary" onClick={() => set('incomplete')}>
            {t('diary.markIncomplete')}
          </Button>
        )}
        {(status === 'complete' || status === 'incomplete') && (
          <Button variant="ghost" onClick={() => set('in_progress')}>
            {t('diary.markInProgress')}
          </Button>
        )}
      </div>
    </Card>
  )
}
