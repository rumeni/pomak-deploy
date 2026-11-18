import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { Button, FormError, LoadingScreen, ScreenHeader, SelectField } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { errorMessage } from '../../lib/api'
import { formatDecimal, parseDecimal, toISODate } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { AmountPicker } from '../nutrition/AmountPicker'
import { useFood, type Food } from '../nutrition/api'
import { fmtValue } from '../nutrition/macroFormat'
import { entryFromFood, isFromFood, validDiaryGrams, withAmount } from './model'
import { cachedFood, deleteEntry, saveEntry, useDiaryDay } from './store'
import { mealLabel, mealSettings, selectableMeals } from './meals'
import { MEALS, type DiaryEntry, type MealKey } from './types'

/**
 * Količina i obrok za stavku iz namirnice.
 * - nova: ?namirnica=<id>&datum=&obrok=
 * - izmena: ?stavka=<id>&datum= (računa se iz snimka stavke, ne iz trenutne namirnice)
 */
export function EntryPage() {
  const { me } = useAuth()
  const [params] = useSearchParams()
  const date = params.get('datum') ?? toISODate(new Date())
  const entryId = params.get('stavka')
  const foodId = params.get('namirnica')
  const { day } = useDiaryDay(me?.id, date)

  // Refresh from the server before a NEW diary entry; local food is only
  // the offline fallback. Editing an existing entry keeps its own snapshot.
  const lookupId = foodId ?? (entryId ? (day?.entries.find((e) => e.id === entryId)?.food_id ?? null) : null)
  const local = useLiveQuery(async () => (me && lookupId ? ((await cachedFood(me.id, lookupId)) ?? null) : null), [me?.id, lookupId])
  const remote = useFood(lookupId ?? undefined)
  const food = entryId
    ? (remote.data ?? local ?? undefined)
    : (remote.isFetching && navigator.onLine ? undefined : remote.data ?? local ?? undefined)

  if (entryId) {
    if (!day) return <LoadingScreen />
    const entry = day.entries.find((e) => e.id === entryId)
    if (!entry) return <NotFound />
    if (!isFromFood(entry)) return <Navigate to={`/ishrana/rucni?stavka=${entry.id}&datum=${date}`} replace />
    return <EntryForm key={`${entry.id}:${food?.id ?? ''}`} date={date} meal={entry.meal} entry={entry} food={food} />
  }
  if (!food) {
    return local === undefined || remote.isFetching ? <LoadingScreen /> : <NotFound />
  }
  const meal = (MEALS.includes(params.get('obrok') as MealKey) ? params.get('obrok') : 'snack') as MealKey
  return <EntryForm key={food.id} date={date} meal={meal} food={food} />
}

function NotFound() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <>
      <ScreenHeader title={t('nutrition.title')} onBack={() => navigate(-1)} />
      <p className="p-6 text-center text-danger">{t('diary.entryNotFound')}</p>
    </>
  )
}

function EntryForm({ date, meal: initialMeal, food, entry }: { date: string; meal: MealKey; food?: Food; entry?: DiaryEntry }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { me } = useAuth()
  // Nova stavka kreće od prve porcije ("1 jaje"); izmena zadržava upisanu količinu.
  const firstPortion = entry ? undefined : food?.portions[0]
  const [grams, setGrams] = useState(
    entry?.grams ? formatDecimal(Number(entry.grams)) : firstPortion ? formatDecimal(Number(firstPortion.grams)) : '100',
  )
  const [portionName, setPortionName] = useState(entry?.portion_name ?? firstPortion?.name ?? '')
  const [meal, setMeal] = useState<MealKey>(initialMeal)
  const settings = mealSettings(me?.profile.meals)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  // ID nove stavke se pravi jednom: ponovljeno "Dodaj" posle greške ne pravi duplikat.
  const [newId] = useState(uuid)

  const amount = parseDecimal(grams)
  const valid = validDiaryGrams(amount)
  // Izmena računa iz snimka stavke; `food` tada služi samo za porcije.
  const draft = valid
    ? entry
      ? withAmount(entry, amount, portionName, meal)
      : entryFromFood(newId, date, meal, food!, amount, portionName, new Date())
    : null
  const shown = draft?.preview

  const back = () => navigate(`/ishrana?datum=${date}`, { replace: true })

  const onSave = async () => {
    if (busy.current) return
    if (!me || !draft) return setError(t('diary.invalidAmount'))
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      await saveEntry(me.id, entry?.id ?? newId, draft, entry?.date)
      back()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (busy.current || !me || !entry || !window.confirm(t('diary.deleteConfirm', { name: entry.name }))) return
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      await deleteEntry(me.id, entry.date, entry.id)
      back()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  const rows: [string, string | null][] = [
    [t('nutrition.protein'), shown?.protein_g ?? null],
    [t('nutrition.carbs'), shown?.carbs_g ?? null],
    [t('nutrition.fat'), shown?.fat_g ?? null],
  ]

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={entry?.name ?? food!.name} onBack={() => navigate(-1)} />
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
        <AmountPicker
          value={grams}
          portions={food?.portions ?? []}
          onChange={(g, portion) => {
            setGrams(g)
            setPortionName(portion)
          }}
        />
        <SelectField label={t('diary.meal')} name="meal" value={meal} onChange={(e) => setMeal(e.target.value as MealKey)}>
          {selectableMeals(settings, meal).map((m) => (
            <option key={m.key} value={m.key}>
              {mealLabel(m.key, settings, t)}
            </option>
          ))}
        </SelectField>

        <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line/60">
          <p className="text-3xl font-bold tabular-nums">
            {shown ? Math.round(Number(shown.kcal)) : '–'} <span className="text-base font-medium text-muted">{t('nutrition.kcal')}</span>
          </p>
          <dl className="mt-2 grid grid-cols-3 gap-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="font-semibold tabular-nums">{shown ? `${fmtValue(value)}${value === null ? '' : ' g'}` : '–'}</dd>
              </div>
            ))}
          </dl>
          {entry && <p className="mt-3 text-xs text-muted">{t('diary.snapshotNote')}</p>}
        </section>

        <FormError message={error ?? (valid ? null : t('diary.invalidAmount'))} />
        <Button onClick={() => void onSave()} disabled={!valid || saving}>
          {entry ? t('diary.saveChanges') : t('diary.addToDiary')}
        </Button>
        {entry && (
          <Button variant="ghost" className="text-danger" disabled={saving} onClick={() => void onDelete()}>
            {t('diary.deleteEntry')}
          </Button>
        )}
      </div>
    </div>
  )
}
