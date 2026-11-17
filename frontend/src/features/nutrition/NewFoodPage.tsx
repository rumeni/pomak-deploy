import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { Button, Field, FormError, LoadingScreen, ScreenHeader, SelectField } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { parseDecimal } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { lookupBarcode, useCreateFood, useFood, useUpdateFood, type Food, type FoodState, type NewFood } from './api'
import { FoodScanner, type ScanResult } from './FoodScanner'
import { mergeScan } from './scanMerge'
import { kcalCheck } from './labelCheck'
import { foodFormValue } from './foodFormValues'
import { useAuth } from '../../lib/auth'
import { rememberFood } from '../diary/store'
import { MEALS, type MealKey } from '../diary/types'

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
  const { search } = useLocation()
  const existing = useFood(id)
  const { t } = useTranslation()
  if (id && existing.isLoading) return <LoadingScreen />
  const editable = existing.data && (existing.data.can_edit ?? (existing.data.source === 'custom' && existing.data.is_custom))
  if (id && (!existing.data || !editable || existing.data.source === 'recipe')) {
    return <p className="p-6 text-center text-danger">{t('nutrition.notFound')}</p>
  }
  // A new form per link (e.g. another search term), so values from a previous one never linger.
  return <FoodForm key={id ?? `new${search}`} initialFood={id ? existing.data : undefined} />
}

function FoodForm({ initialFood }: { initialFood?: Food }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const id = initialFood?.id
  // A timed-out first POST may have succeeded. Keep this UUID for every retry
  // of this form (including retries after the user changes nutrition values).
  const [createId] = useState(uuid)
  const editing = Boolean(id)
  const create = useCreateFood()
  const update = useUpdateFood()
  const { me } = useAuth()
  const [params] = useSearchParams()
  // Opened from "add to meal": name typed in the search, and where to put the food afterwards.
  const meal = MEALS.includes(params.get('obrok') as MealKey) ? (params.get('obrok') as MealKey) : null
  const date = params.get('datum')
  const [name, setName] = useState(initialFood?.name ?? params.get('naziv') ?? '')
  const [state, setState] = useState<FoodState>(initialFood?.state ?? 'prepared')
  const [values, setValues] = useState<Record<ValueField, string>>(() => ({
    kcal: foodFormValue(initialFood?.kcal),
    protein_g: foodFormValue(initialFood?.protein_g),
    carbs_g: foodFormValue(initialFood?.carbs_g),
    fat_g: foodFormValue(initialFood?.fat_g),
    fiber_g: foodFormValue(initialFood?.fiber_g),
  }))
  const [portions, setPortions] = useState<{ key: string; name: string; grams: string }[]>(
    () => initialFood?.portions.map((portion) => ({ ...portion, grams: foodFormValue(portion.grams), key: uuid() })) ?? [],
  )
  const [error, setError] = useState<string | null>(null)
  const [barcode, setBarcode] = useState(initialFood?.barcode ?? '')
  // Private unless the athlete deliberately shares it: name, values and portions become public.
  const [shared, setShared] = useState(false)
  // Where the values came from ("openfoodfacts:<code>"), kept with the food.
  const [sourceRef, setSourceRef] = useState('')
  const fromOpenFoodFacts = sourceRef.startsWith('openfoodfacts:')
  // Fields filled by a scan, highlighted until the athlete checks them.
  const [scanned, setScanned] = useState<Set<ValueField>>(new Set())
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [existingFood, setExistingFood] = useState<Food | null>(null)
  // Ignore a delayed scan response if the user edited the form after starting the scan.
  const editVersion = useRef(0)
  const scannedVersion = useRef(0)
  const markEdited = () => { editVersion.current += 1 }

  const applyScan = (result: ScanResult) => {
    if (editVersion.current !== scannedVersion.current) return
    setExistingFood(null)
    if (result.food) {
      // Offer the known food without changing any part of this unsaved draft.
      setExistingFood(result.food)
      setScanNote(result.note)
      return
    }
    // Never mix two products: a different barcode replaces the whole draft (after asking).
    const { next, filled, replaces } = mergeScan({ name, barcode, values, sourceRef }, result)
    if (replaces && !window.confirm(t('scan.replaceConfirm'))) return
    const differentBarcode = result.kind === 'barcode' && !!result.barcode && !!barcode && result.barcode !== barcode
    if (differentBarcode || (result.kind === 'barcode' && replaces)) {
      setPortions([])
      setShared(false)
    }
    setName(next.name)
    setBarcode(next.barcode)
    setValues(next.values)
    setSourceRef(next.sourceRef)
    setScanned(new Set(filled))
    if (next.sourceRef.startsWith('openfoodfacts:')) setShared(false)
    setScanNote(result.note)
  }

  const openExistingFood = (food: Food) => {
    if (meal && date) {
      if (me) void rememberFood(me.id, food)
      return navigate(`/ishrana/stavka?namirnica=${food.id}&datum=${date}&obrok=${meal}`, { replace: true })
    }
    navigate(`/ishrana/namirnice/${food.id}`, { replace: true })
  }

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
    const code = barcode.trim()
    if (code && !/^\d{8,14}$/.test(code)) throw new FormInputError('invalidBarcode')
    return {
      ...(editing ? {} : { shared: shared && !fromOpenFoodFacts, ...(sourceRef ? { source_ref: sourceRef } : {}) }),
      barcode: code,
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
      const success = (food: Food) => {
        if (!id && meal && date) {
          // Straight to the amount for the meal it was added for.
          if (me) void rememberFood(me.id, food)
          return navigate(`/ishrana/stavka?namirnica=${food.id}&datum=${date}&obrok=${meal}`, { replace: true })
        }
        navigate(`/ishrana/namirnice/${food.id}`, { replace: true })
      }
      if (id) update.mutate({ id, body }, { onSuccess: success })
      else create.mutate({ ...body, id: createId }, {
        onSuccess: success,
        onError: (cause) => {
          // Someone already added this product: offer it instead.
          const existingId = (cause as { response?: { data?: { existing_id?: string[] } } }).response?.data?.existing_id?.[0]
          if (existingId) void lookupBarcode(body.barcode!).then((r) => r.food && setExistingFood(r.food)).catch(() => undefined)
        },
      })
    } catch (err) {
      if (err instanceof FormInputError) setError(t(`newFood.errors.${err.message}`, err.params))
      else throw err
    }
  }

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t(editing ? 'newFood.editTitle' : 'newFood.title')} onBack={() => navigate(-1)} />
      <form className="mx-auto flex max-w-xl flex-col gap-4 p-4" onSubmit={onSubmit} noValidate>
        {!editing && <FoodScanner onStart={() => { scannedVersion.current = editVersion.current }} onResult={applyScan} autoStart={params.get('skeniraj') === '1'} />}
        {existingFood && (
          <div role="status" className="flex flex-col gap-2 rounded-2xl bg-accent/15 p-4">
            <p className="font-semibold">{t('newFood.alreadyThere', { name: existingFood.name })}</p>
            <p className="text-sm text-muted">{Math.round(Number(existingFood.kcal))} kcal {t('nutrition.per100')}</p>
            <Button type="button" onClick={() => openExistingFood(existingFood)}>
              {meal ? t('newFood.useForMeal') : t('newFood.openExisting')}
            </Button>
          </div>
        )}
        {scanNote && <p className="rounded-xl bg-surface px-3 py-2 text-sm">{scanNote}</p>}
        <Field label={t('newFood.name')} name="name" placeholder={t('newFood.nameExample')} value={name} onChange={(e) => { markEdited(); setName(e.target.value); setExistingFood(null) }} />
        <SelectField label={t('newFood.state')} name="state" value={state} onChange={(e) => { markEdited(); setState(e.target.value as FoodState) }}>
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
              <div key={field} className={scanned.has(field) ? 'rounded-xl ring-2 ring-accent/60 ring-offset-2 ring-offset-surface' : ''}>
                <Field
                  label={label}
                  name={field}
                  inputMode="decimal"
                  value={values[field]}
                  onChange={(e) => {
                    markEdited()
                    setValues((v) => ({ ...v, [field]: e.target.value }))
                    setScanned((s) => { const next = new Set(s); next.delete(field); return next })
                  }}
                />
              </div>
            ))}
          </div>
          {(() => {
            const check = kcalCheck(values)
            return check && !check.ok ? (
              <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
                {t('newFood.kcalMismatch', { expected: check.expected })}
              </p>
            ) : null
          })()}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">{t('newFood.portions')}</legend>
          {portions.map((p) => (
            <div key={p.key} className="grid grid-cols-[1fr_6rem_2.75rem] items-end gap-2">
              <Field
                label={t('newFood.portionName')}
                name={`portion-name-${p.key}`}
                value={p.name}
                onChange={(e) => { markEdited(); setPortions((list) => list.map((x) => (x.key === p.key ? { ...x, name: e.target.value } : x))) }}
              />
              <Field
                label={t('newFood.portionGrams')}
                name={`portion-grams-${p.key}`}
                inputMode="decimal"
                value={p.grams}
                onChange={(e) => { markEdited(); setPortions((list) => list.map((x) => (x.key === p.key ? { ...x, grams: e.target.value } : x))) }}
              />
              <button
                type="button"
                aria-label={t('newFood.removePortion')}
                onClick={() => { markEdited(); setPortions((list) => list.filter((x) => x.key !== p.key)) }}
                className="flex min-h-12 items-center justify-center rounded-xl text-muted active:bg-line"
              >
                ✕
              </button>
            </div>
          ))}
          <Button type="button" variant="ghost" onClick={() => { markEdited(); setPortions((list) => [...list, { key: uuid(), name: '', grams: '' }]) }}>
            {t('newFood.addPortion')}
          </Button>
        </fieldset>

        <Field
          label={t('newFood.barcode')}
          name="barcode"
          inputMode="numeric"
          placeholder={t('newFood.barcodePlaceholder')}
          value={barcode}
          onChange={(e) => { markEdited(); setBarcode(e.target.value.replace(/\s/g, '')); setExistingFood(null) }}
        />
        {!editing && (
          <label className={`flex items-start gap-3 rounded-xl bg-card p-3 ring-1 ring-line/60 ${fromOpenFoodFacts ? 'opacity-70' : ''}`}>
            <input
              type="checkbox"
              checked={shared && !fromOpenFoodFacts}
              disabled={fromOpenFoodFacts}
              onChange={(e) => { markEdited(); setShared(e.target.checked) }}
              className="mt-1 size-5 shrink-0 accent-brand"
            />
            <span>
              <span className="block font-semibold">{t('newFood.shareTitle')}</span>
              <span className="block text-sm text-muted">{t(fromOpenFoodFacts ? 'newFood.shareOffText' : 'newFood.shareText')}</span>
            </span>
          </label>
        )}

        <FormError message={error ?? (update.isError ? errorMessage(update.error) : create.isError ? errorMessage(create.error) : null)} />
        <Button type="submit" disabled={create.isPending || update.isPending}>
          {create.isPending || update.isPending ? t('common.saving') : t('newFood.save')}
        </Button>
      </form>
    </div>
  )
}
