import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button, Field, FormError, ScreenHeader, SelectField } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { parseDecimal } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { useCreateFood, type FoodState, type NewFood } from './api'

const STATES: FoodState[] = ['prepared', 'raw', 'cooked', 'na']
type ValueField = 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g'

class FormInputError extends Error {
  readonly params: Record<string, string>
  constructor(key: string, params: Record<string, string> = {}) {
    super(key)
    this.params = params
  }
}

/** Lična namirnica, npr. sa deklaracije. Prazna vrednost = nepoznato (null), ne 0. */
export function NewFoodPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const create = useCreateFood()
  const [name, setName] = useState('')
  const [state, setState] = useState<FoodState>('prepared')
  const [values, setValues] = useState<Record<ValueField, string>>({ kcal: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' })
  const [portions, setPortions] = useState<{ key: string; name: string; grams: string }[]>([])
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
      create.mutate(toBody(), { onSuccess: (food) => navigate(`/ishrana/namirnice/${food.id}`, { replace: true }) })
    } catch (err) {
      if (err instanceof FormInputError) setError(t(`newFood.errors.${err.message}`, err.params))
      else throw err
    }
  }

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('newFood.title')} onBack={() => navigate(-1)} />
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

        <FormError message={error ?? (create.isError ? errorMessage(create.error) : null)} />
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? t('common.saving') : t('newFood.save')}
        </Button>
      </form>
    </div>
  )
}
