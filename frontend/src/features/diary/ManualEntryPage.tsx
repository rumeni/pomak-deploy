import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Button, Field, FormError, LoadingScreen, ScreenHeader, SelectField } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { formatDecimal, toISODate } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { manualEntry } from './model'
import { findManualEntryForEdit } from './manualEntryLookup'
import { parseManualValue, type ManualValueField } from './manualEntryValidation'
import { deleteEntry, saveEntry, useDiaryDay } from './store'
import { mealLabel, mealSettings, selectableMeals } from './meals'
import { MEALS, type DiaryEntry, type MealKey } from './types'

/** Ručni unos poznatih vrednosti za celu pojedenu količinu (?datum=&obrok= ili ?stavka=&datum=). */
export function ManualEntryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { me } = useAuth()
  const [params] = useSearchParams()
  const date = params.get('datum') ?? toISODate(new Date())
  const entryId = params.get('stavka')
  const { day } = useDiaryDay(me?.id, date)

  if (entryId && !day) return <LoadingScreen />
  const entry = findManualEntryForEdit(entryId, day)
  if (entryId && !entry) return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('diary.manualTitle')} onBack={() => navigate(-1)} />
      <p className="p-6 text-center text-danger">{t('diary.entryNotFound')}</p>
    </div>
  )
  const meal = entry?.meal ?? ((MEALS.includes(params.get('obrok') as MealKey) ? params.get('obrok') : 'snack') as MealKey)
  return <ManualForm key={entry?.id ?? 'new'} date={date} meal={meal} entry={entry} />
}

function ManualForm({ date, meal: initialMeal, entry }: { date: string; meal: MealKey; entry?: DiaryEntry }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { me } = useAuth()
  const [newId] = useState(uuid)
  const [name, setName] = useState(entry?.name ?? '')
  const [meal, setMeal] = useState<MealKey>(initialMeal)
  const settings = mealSettings(me?.profile.meals)
  const initial = (v: string | null | undefined) => (v == null ? '' : formatDecimal(Number(v)))
  const [values, setValues] = useState<Record<ManualValueField, string>>({
    kcal: initial(entry?.kcal),
    protein_g: initial(entry?.protein_g),
    carbs_g: initial(entry?.carbs_g),
    fat_g: initial(entry?.fat_g),
    fiber_g: initial(entry?.fiber_g),
  })
  const [error, setError] = useState<string | null>(null)

  const fields: [ManualValueField, string][] = [
    ['kcal', t('diary.manualKcal')],
    ['protein_g', `${t('nutrition.protein')} (g)`],
    ['carbs_g', `${t('nutrition.carbs')} (g)`],
    ['fat_g', `${t('nutrition.fat')} (g)`],
    ['fiber_g', `${t('nutrition.fiber')} (g)`],
  ]

  const back = () => navigate(`/ishrana?datum=${date}`, { replace: true })

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!me) return
    if (!name.trim()) return setError(t('newFood.errors.nameRequired'))
    if (name.trim().length > 150) return setError(t('diary.manualNameTooLong', { max: 150 }))
    const parsed: Record<ManualValueField, string | null> = { kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null }
    for (const [field, label] of fields) {
      const text = values[field].trim()
      const result = parseManualValue(field, text)
      if (!result.ok) {
        if (result.error === 'invalid') return setError(t('newFood.errors.invalidNumber', { field: label, value: text }))
        if (result.error === 'range') return setError(t('diary.manualValueRange', { field: label, max: result.max }))
        return setError(t('diary.manualValuePrecision', { field: label, places: result.places }))
      }
      parsed[field] = result.value
    }
    if (parsed.kcal === null) return setError(t('newFood.errors.kcalRequired'))
    const draft = manualEntry(entry?.id ?? newId, date, meal, name.trim(), parsed, new Date(), entry)
    await saveEntry(me.id, entry?.id ?? newId, draft, entry?.date)
    back()
  }

  const onDelete = async () => {
    if (!me || !entry || !window.confirm(t('diary.deleteConfirm', { name: entry.name }))) return
    await deleteEntry(me.id, entry.date, entry.id)
    back()
  }

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('diary.manualTitle')} onBack={() => navigate(-1)} />
      <form className="mx-auto flex max-w-xl flex-col gap-4 p-4" onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field label={t('diary.manualName')} name="name" value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label={t('diary.meal')} name="meal" value={meal} onChange={(e) => setMeal(e.target.value as MealKey)}>
          {selectableMeals(settings, meal).map((m) => (
            <option key={m.key} value={m.key}>
              {mealLabel(m.key, settings, t)}
            </option>
          ))}
        </SelectField>
        <p className="text-sm text-muted">{t('diary.manualHint')}</p>
        <div className="grid grid-cols-2 gap-3">
          {fields.map(([field, label]) => (
            <Field
              key={field}
              label={label}
              name={field}
              inputMode="decimal"
              value={values[field]}
              onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
            />
          ))}
        </div>
        <FormError message={error} />
        <Button type="submit">{entry ? t('diary.saveChanges') : t('diary.addToDiary')}</Button>
        {entry && (
          <Button type="button" variant="ghost" className="text-danger" onClick={() => void onDelete()}>
            {t('diary.deleteEntry')}
          </Button>
        )}
      </form>
    </div>
  )
}
