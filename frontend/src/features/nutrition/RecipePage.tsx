import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Button, Field, FormError, LoadingScreen, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { useUnsavedWarning } from '../../lib/useUnsavedWarning'
import { formatDecimal, parseDecimal } from '../../lib/format'
import { useDebounced } from '../../lib/useDebounced'
import { uuid } from '../../lib/uuid'
import { useDeleteFood, useFoods, useRecipe, useSaveRecipe, type Food, type Recipe, type RecipeBody } from './api'
import { MacroLine } from './MacroLine'
import { previewRecipe } from './recipe'

interface IngredientRow {
  key: string
  food: Food
  grams: string
  portion_name: string
}

class FormInputError extends Error {
  readonly params: Record<string, string>
  constructor(key: string, params: Record<string, string> = {}) {
    super(key)
    this.params = params
  }
}

/** Novi recept (/ishrana/recepti/novi) ili izmena postojećeg (/ishrana/recepti/:id). */
export function RecipePage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: recipe, isLoading, isError } = useRecipe(id)

  if (id && isLoading) return <LoadingScreen />
  if (id && (isError || !recipe)) {
    return (
      <>
        <ScreenHeader title={t('recipe.editTitle')} onBack={() => navigate(-1)} />
        <p className="p-6 text-center text-danger">{t('nutrition.notFound')}</p>
      </>
    )
  }
  return <RecipeForm key={recipe?.id ?? 'new'} recipe={recipe} />
}

function RecipeForm({ recipe }: { recipe?: Recipe }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [id] = useState(() => recipe?.id ?? uuid())
  const save = useSaveRecipe(!recipe)
  const remove = useDeleteFood()
  const [name, setName] = useState(recipe?.name ?? '')
  const [rows, setRows] = useState<IngredientRow[]>(
    () => recipe?.ingredients.map((i) => ({ key: uuid(), food: i.food, grams: formatDecimal(Number(i.grams)), portion_name: i.portion_name })) ?? [],
  )
  const [mass, setMass] = useState(recipe?.mass_g ? formatDecimal(Number(recipe.mass_g)) : '')
  const [servings, setServings] = useState(String(recipe?.servings ?? 1))
  const [picking, setPicking] = useState(!recipe)
  const [error, setError] = useState<string | null>(null)
  const fingerprint = JSON.stringify([name, rows, mass, servings])
  const initialFingerprint = useRef(fingerprint)
  const confirmLeave = useUnsavedWarning(fingerprint !== initialFingerprint.current)

  const parsedMass = mass.trim() ? parseDecimal(mass) : null
  const parsedServings = Number.parseInt(servings, 10)
  const preview = previewRecipe(
    rows.map((r) => ({ food: r.food, grams: parseDecimal(r.grams) ?? 0 })),
    parsedMass && parsedMass > 0 ? parsedMass : null,
    Number.isFinite(parsedServings) ? parsedServings : 1,
  )

  const updateRow = (key: string, patch: Partial<IngredientRow>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const toBody = (): RecipeBody => {
    if (!name.trim()) throw new FormInputError('nameRequired')
    if (!rows.length) throw new FormInputError('noIngredients')
    const ingredients = rows.map((r) => {
      const grams = parseDecimal(r.grams)
      if (grams === null || grams <= 0) throw new FormInputError('invalidGrams', { name: r.food.name })
      return { food_id: r.food.id, grams: String(grams), portion_name: r.portion_name }
    })
    if (mass.trim() && (parsedMass === null || parsedMass <= 0)) throw new FormInputError('invalidMass')
    if (!/^\d+$/.test(servings.trim()) || parsedServings < 1 || parsedServings > 100) throw new FormInputError('invalidServings')
    return { id, name: name.trim(), mass_g: parsedMass === null ? null : String(parsedMass), servings: parsedServings, ingredients }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      save.mutate(toBody(), { onSuccess: (saved) => navigate(`/ishrana/namirnice/${saved.id}`, { replace: true }) })
    } catch (err) {
      if (err instanceof FormInputError) setError(t(`recipe.errors.${err.message}`, err.params))
      else throw err
    }
  }

  const onDelete = () => {
    if (!recipe || !window.confirm(t('recipe.deleteConfirm', { name: recipe.name }))) return
    remove.mutate(recipe.id, { onSuccess: () => navigate('/ishrana/namirnice', { replace: true }) })
  }

  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={recipe ? t('recipe.editTitle') : t('recipe.newTitle')} onBack={() => confirmLeave(() => navigate(-1))} />
      <form className="mx-auto flex max-w-xl flex-col gap-4 p-4" onSubmit={onSubmit} noValidate>
        <Field label={t('recipe.name')} name="name" placeholder={t('recipe.nameExample')} value={name} onChange={(e) => setName(e.target.value)} />

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">{t('recipe.ingredients')}</legend>
          <p className="text-sm text-muted">{t('recipe.ingredientsHint')}</p>
          {!!rows.length && (
            <ul className="flex flex-col rounded-2xl bg-card shadow-sm ring-1 ring-line/60">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center gap-2 border-b border-line py-2 pl-4 pr-1 last:border-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.food.name}</span>
                    {r.portion_name && <span className="block truncate text-xs text-muted">{r.portion_name}</span>}
                  </span>
                  <input
                    value={r.grams}
                    onChange={(e) => updateRow(r.key, { grams: e.target.value, portion_name: '' })}
                    inputMode="decimal"
                    aria-label={`${t('nutrition.amount')}: ${r.food.name}`}
                    className="min-h-11 w-20 rounded-xl border border-line bg-surface px-2 text-right tabular-nums outline-none focus:border-brand focus:bg-card"
                  />
                  <span className="text-sm text-muted">g</span>
                  <button
                    type="button"
                    aria-label={`${t('recipe.removeIngredient')}: ${r.food.name}`}
                    onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted active:bg-line"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picking ? (
            <IngredientSearch
              onPick={(food) => {
                setRows((list) => [...list, { key: uuid(), food, grams: '100', portion_name: '' }])
                setPicking(false)
              }}
              onClose={() => setPicking(false)}
            />
          ) : (
            <Button type="button" variant="ghost" onClick={() => setPicking(true)}>
              {t('recipe.addIngredient')}
            </Button>
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('recipe.mass')} name="mass" inputMode="decimal" value={mass} onChange={(e) => setMass(e.target.value)} />
          <Field label={t('recipe.servings')} name="servings" inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} />
        </div>
        <p className="-mt-2 text-sm text-muted">{t('recipe.massHint', { grams: formatDecimal(preview?.rawMass ?? 0) })}</p>

        {preview && (
          <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line/60" aria-live="polite">
            <h2 className="font-semibold">{t('recipe.preview')}</h2>
            <PreviewLine label={t('nutrition.per100')} kcal={preview.per100.kcal} values={preview.per100} factor={1} />
            <PreviewLine
              label={t('recipe.perServing', { grams: formatDecimal(Math.round(preview.servingGrams)) })}
              kcal={preview.per100.kcal}
              values={preview.per100}
              factor={preview.servingGrams / 100}
            />
            {Object.values(preview.per100).some((v) => v === null) && <p className="mt-2 text-xs text-muted">{t('recipe.unknownHint')}</p>}
          </section>
        )}

        <FormError message={error ?? (save.isError ? errorMessage(save.error) : remove.isError ? errorMessage(remove.error) : null)} />
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('recipe.save')}
        </Button>
        {recipe && (
          <Button type="button" variant="ghost" className="text-danger" onClick={onDelete} disabled={remove.isPending}>
            {t('recipe.delete')}
          </Button>
        )}
      </form>
    </div>
  )
}

function PreviewLine({
  label,
  kcal,
  values,
  factor,
}: {
  label: string
  kcal: number | null
  values: { protein_g: number | null; carbs_g: number | null; fat_g: number | null }
  factor: number
}) {
  const { t } = useTranslation()
  const scaled = (v: number | null) => (v === null ? null : v * factor)
  return (
    <div className="mt-2 flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm">
        <span className="font-semibold tabular-nums">
          {kcal === null ? '?' : Math.round(kcal * factor)} {t('nutrition.kcal')}
        </span>
        <span className="block text-muted">
          <MacroLine protein={scaled(values.protein_g)} carbs={scaled(values.carbs_g)} fat={scaled(values.fat_g)} />
        </span>
      </span>
    </div>
  )
}

/** Pretraga namirnica za sastojak (recept ne može da sadrži drugi recept). */
function IngredientSearch({ onPick, onClose }: { onPick: (food: Food) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const search = useDebounced(q)
  const { data, isLoading, isError } = useFoods(search)
  const foods = data?.filter((f) => f.source !== 'recipe').slice(0, 20)

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-line/60">
      <div className="flex gap-2">
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('nutrition.searchPlaceholder')}
          aria-label={t('recipe.searchIngredient')}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-base outline-none focus:border-brand focus:bg-card"
        />
        <button type="button" onClick={onClose} aria-label={t('recipe.closeSearch')} className="flex size-12 items-center justify-center rounded-xl text-muted active:bg-line">
          ✕
        </button>
      </div>
      {isLoading && <p className="py-2 text-center text-sm text-muted">{t('common.loading')}</p>}
      {isError && <p className="py-2 text-center text-sm text-danger">{t('nutrition.loadFailed')}</p>}
      {foods?.length === 0 && <p className="py-2 text-center text-sm text-muted">{t('recipe.noIngredientResults', { q: search })}</p>}
      <ul className="flex flex-col">
        {foods?.map((food) => (
          <li key={food.id} className="border-b border-line last:border-0">
            <button type="button" onClick={() => onPick(food)} className="flex min-h-14 w-full flex-col justify-center px-2 py-1.5 text-left active:bg-brand-soft">
              <span className="font-medium">{food.name}</span>
              <span className="text-xs text-muted">
                {Math.round(Number(food.kcal))} {t('nutrition.kcal')} · <MacroLine protein={food.protein_g} carbs={food.carbs_g} fat={food.fat_g} /> · {t('nutrition.per100')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
