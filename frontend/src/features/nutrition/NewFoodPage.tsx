import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button, Field, FormError, LoadingScreen, ScreenHeader, SelectField } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { parseDecimal } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { useCreateFood, useFood, useUpdateFood, type Food, type FoodState, type NewFood } from './api'

const STATES: FoodState[] = ['prepared', 'raw', 'cooked', 'na']
type ValueField = 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g'

class FormInputError extends Error {
  readonly params: Record<string, string>
  constructor(key: string, params: Record<string, string> = {}) {
    super(key)
    this.params = params
  }
}

/** Editor shared by creation and editing; keyed to the food ID so fetched
 * initial values are read only once and query refetch cannot reset dirty form. */
export function NewFoodPage() {
  const { id } = useParams()
  const existing = useFood(id)
  const { t } = useTranslation()
  if (id && existing.isLoading) return <LoadingScreen />
  if (id && (!existing.data || existing.data.source !== 'custom' || !existing.data.is_custom)) {
    return <p className="p-6 text-center text-danger">{t('nutrition.notFound')}</p>
  }
  return <FoodForm key={id ?? 'new'} initialFood={id ? existing.data : undefined} />
}

function FoodForm({ initialFood }: { initialFood?: Food }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const id = initialFood?.id
  const editing = Boolean(id)
  const create = useCreateFood()
  const update = useUpdateFood()
  const [name, setName] = useState(initialFood?.name ?? '')
  const [state, setState] = useState<FoodState>(initialFood?.state ?? 'prepared')
  const [values, setValues] = useState<Record<ValueField, string>>(() => ({
    kcal: initialFood?.kcal ?? '',
    protein_g: initialFood?.protein_g ?? '',
    carbs_g: initialFood?.carbs_g ?? '',
    fat_g: initialFood?.fat_g ?? '',
    fiber_g: initialFood?.fiber_g ?? '',
  }))
  const [portions, setPortions] = useState<{ key: string; name: string; grams: string }[]>(
    () => initialFood?.portions.map((portion) => ({ ...portion, key: uuid() })) ?? [],
  )
  const [error, setError] = useState<string | null>(null)

  const fields: [ValueField, string][] = [
    ['kcal', t('newFood.kcalRequired')],
    ['protein_g', `${t('nutrition.protein')} (g)`],
    ['carbs_g', `${t('nutrition.carbs')} (g)`],
    ['fat_g', `${t('nutrition.fat')} (g)`],
    ['fiber_g', `${t('nutrition.fiber')} (g)`],
  ]

  const toBody = (): NewFood => {
    if (!name.trim()) throw new FormInputError('nameRequired')
    const number = (field: ValueField, label: string): string | null => {
      const text = values[field].trim()
      if (!text) return null
      const n = parseDecimal(text)
      if (n === null) throw new FormInputError('invalidNumber', { field: label, value: text })
      return String(n)
    }
    const parsed = Object.fromEntries(fields.map(([f, label]) => [f, number(f, label)])) as Record<ValueField, string | null>
    if (parsed.kcal === null) throw new FormInputError('kcalRequired')
    return {
      name: name.trim(),
      state,
      kcal: parsed.kcal,
      protein_g: parsed.protein_g,
      carbs_g: parsed.carbs_g,
      fat_g: parsed.fat_g,
      fiber_g: parsed.fiber_g,
      portions: portions
        .filter((p) => p.name.trim() || p.grams.trim())
        .map((p) => {
          const grams = parseDecimal(p.grams)
          if (!p.name.trim() || grams === null) throw new FormInputError('portionIncomplete')
          return { name: p.name.trim(), grams: String(grams) }
        }),
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const body = toBody()
      const success = (food: { id: string }) => navigate(`/ishrana/namirnice/${food.id}`, { replace: true })
      if (id) update.mutate({ id, body }, { onSuccess: success })
      else create.mutate(body, { onSuccess: success })
    } catch (err) {
      if (err instanceof FormInputError) setError(t(`newFood.errors.${err.message}`, err.params))
      else throw err
    }
  }

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t(editing ? 'newFood.editTitle' : 'newFood.title')} onBack={() => navigate(-1)} />
      <form className="mx-auto flex max-w-xl flex-col gap-4 p-4" onSubmit={onSubmit} noValidate>
        <Field label={t('newFood.name')} name="name" placeholder={t('newFood.nameExample')} value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label={t('newFood.state')} name="state" value={state} onChange={(e) => setState(e.target.value as FoodState)}>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {t(`nutrition.state_${s}`)}
            </option>
          ))}
        </SelectField>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold">{t('newFood.valuesPer100')}</legend>
          <p className="text-sm text-muted">{t('newFood.optionalHint')}</p>
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
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">{t('newFood.portions')}</legend>
          {portions.map((p) => (
            <div key={p.key} className="grid grid-cols-[1fr_6rem_2.75rem] items-end gap-2">
              <Field
                label={t('newFood.portionName')}
                name={`portion-name-${p.key}`}
                value={p.name}
                onChange={(e) => setPortions((list) => list.map((x) => (x.key === p.key ? { ...x, name: e.target.value } : x)))}
              />
              <Field
                label={t('newFood.portionGrams')}
                name={`portion-grams-${p.key}`}
                inputMode="decimal"
                value={p.grams}
                onChange={(e) => setPortions((list) => list.map((x) => (x.key === p.key ? { ...x, grams: e.target.value } : x)))}
              />
              <button
                type="button"
                aria-label={t('newFood.removePortion')}
                onClick={() => setPortions((list) => list.filter((x) => x.key !== p.key))}
                className="flex min-h-12 items-center justify-center rounded-xl text-muted active:bg-line"
              >
                ✕
              </button>
            </div>
          ))}
          <Button type="button" variant="ghost" onClick={() => setPortions((list) => [...list, { key: uuid(), name: '', grams: '' }])}>
            {t('newFood.addPortion')}
          </Button>
        </fieldset>

        <FormError message={error ?? (update.isError ? errorMessage(update.error) : create.isError ? errorMessage(create.error) : null)} />
        <Button type="submit" disabled={create.isPending || update.isPending}>
          {create.isPending || update.isPending ? t('common.saving') : t('newFood.save')}
        </Button>
      </form>
    </div>
  )
}
