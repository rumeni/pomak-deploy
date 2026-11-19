import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { DateOfBirthField } from '../../components/DateOfBirthField'
import { Button, Card, ChoiceCards, Field, FormError, LoadingScreen, ScreenHeader, Segmented } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { applyOwnProfileResponse, patchOwnProfile, profileScope } from '../../lib/profileMutation'
import { useAuth } from '../../lib/auth'
import { formatDecimal, formatShortDate, parseDecimal, toISODate } from '../../lib/format'
import type { Profile } from '../../lib/types'
import { uuid } from '../../lib/uuid'
import {
  ACTIVITIES,
  estimateTarget,
  GOALS,
  hasPace,
  PACES,
  useLatestWeight,
  useSaveTarget,
  type Activity,
  type Estimate,
  type Goal,
  type TargetWrite,
  type WeightMeasurement,
} from './api'
import { GoalGuidance } from './GoalGuidance'
import { TargetExplanation } from './TargetExplanation'

type Mode = 'app' | 'manual'

/** Greška u unosu; nosi ključ prevoda poruke. */
class InputError extends Error {}

/** Novi kalorijski cilj: predlog aplikacije (uz pregled pre prihvatanja) ili moj cilj. */
export function TargetSetupPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { me } = useAuth()
  const { data: weight, isLoading } = useLatestWeight()
  const [mode, setMode] = useState<Mode>('app')

  if (!me || isLoading) return <LoadingScreen />
  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title={t('target.newTarget')} onBack={() => navigate(-1)} />
      <div className="mx-auto flex max-w-xl flex-col gap-5 p-4">
        <Segmented
          legend={t('target.modeLegend')}
          options={[
            { value: 'app', label: t('target.mode_app') },
            { value: 'manual', label: t('target.mode_manual') },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'app' ? (
          <AppTargetForm profile={me.profile} weight={weight ?? null} onManual={() => setMode('manual')} />
        ) : (
          <ManualTargetForm />
        )}
      </div>
    </div>
  )
}

function StartDateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation()
  return (
    <Field
      label={t('target.startDate')}
      name="valid_from"
      type="date"
      min={toISODate(new Date())}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function useSaveAndReturn() {
  const navigate = useNavigate()
  const save = useSaveTarget()
  const submit = (validFrom: string, body: TargetWrite) =>
    save.mutate({ validFrom, body }, { onSuccess: () => navigate('/ishrana/cilj', { replace: true }) })
  return { save, submit }
}

function AppTargetForm({ profile, weight, onManual }: { profile: Profile; weight: WeightMeasurement | null; onManual: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { me } = useAuth()
  const [sex, setSex] = useState<Profile['sex']>(profile.sex)
  const [birthDate, setBirthDate] = useState(profile.birth_date ?? '')
  const [height, setHeight] = useState(profile.height_cm ? formatDecimal(Number(profile.height_cm)) : '')
  const [weightText, setWeightText] = useState(weight ? formatDecimal(Number(weight.value)) : '')
  const [activity, setActivity] = useState<Activity | ''>('')
  const [goal, setGoal] = useState<Goal | ''>('')
  const [pace, setPace] = useState('')
  const [special, setSpecial] = useState<'no' | 'yes' | ''>('')
  const [validFrom, setValidFrom] = useState(toISODate(new Date()))
  const [result, setResult] = useState<Estimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const weightId = useRef(uuid())
  const calculationVersion = useRef(0)
  const { save, submit } = useSaveAndReturn()

  // Svaka izmena podataka poništava prikazan predlog: prihvata se samo ono što je izračunato.
  const changed =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      calculationVersion.current += 1
      set(v)
      setResult(null)
    }

  const weightKg = parseDecimal(weightText)
  const paceOptions = goal ? PACES[goal] : []

  const calculate = async () => {
    const version = ++calculationVersion.current
    setError(null)
    setPending(true)
    try {
      const heightCm = parseDecimal(height)
      if (!sex || !birthDate || heightCm === null || weightKg === null) throw new InputError('target.errors.bodyData')
      if (!activity) throw new InputError('target.errors.activity')
      if (!goal || (hasPace(goal) && !pace)) throw new InputError('target.errors.goal')
      if (!special) throw new InputError('target.errors.special')

      // Podaci se čuvaju u profilu i kao merenje težine, pa ih vidi i ostatak aplikacije.
      if (sex !== profile.sex || birthDate !== profile.birth_date || String(heightCm) !== String(Number(profile.height_cm))) {
        if (!me) throw new Error('Authentication changed')
        const submitted = { sex, birth_date: birthDate, height_cm: String(heightCm) }
        const scope = profileScope(me.id)
        const data = await patchOwnProfile(me.id, submitted, scope)
        if (!data) throw new Error('Authentication changed')
        applyOwnProfileResponse(queryClient, scope, data, submitted)
      }
      if (!weight || weightKg !== Number(weight.value)) {
        await api.post('/progress/measurements/', { id: weightId.current, kind: 'weight', value: String(weightKg), measured_on: toISODate(new Date()) })
        weightId.current = uuid()
        await queryClient.invalidateQueries({ queryKey: ['measurements'] })
      }
      const estimate = await estimateTarget(
        { activity, goal, pace: hasPace(goal) ? Number(pace) : 0, special_conditions: special === 'yes' }, validFrom,
      )
      if (version === calculationVersion.current) setResult(estimate)
    } catch (e) {
      setError(e instanceof InputError ? t(e.message) : errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  const accept = () => {
    if (!activity || !goal) return
    submit(validFrom, { mode: 'app', activity, goal, pace: hasPace(goal) ? Number(pace) : 0, special_conditions: special === 'yes' })
  }

  return (
    <>
      <p className="text-sm text-muted">{t('target.appIntro')}</p>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">{t('target.yourData')}</h2>
        <Segmented
          legend={t('onboarding.sex')}
          options={[
            { value: 'male', label: t('onboarding.male') },
            { value: 'female', label: t('onboarding.female') },
          ]}
          value={sex}
          onChange={changed(setSex)}
        />
        <DateOfBirthField value={birthDate} onChange={changed(setBirthDate)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('onboarding.heightCm')} name="height" inputMode="decimal" value={height} onChange={(e) => changed(setHeight)(e.target.value)} />
          <Field label={t('onboarding.weightKg')} name="weight" inputMode="decimal" value={weightText} onChange={(e) => changed(setWeightText)(e.target.value)} />
        </div>
        {weight && <p className="-mt-2 text-sm text-muted">{t('target.lastWeight', { date: formatShortDate(weight.measured_on) })}</p>}
      </section>

      <ChoiceCards
        name="activity"
        legend={t('target.activityLegend')}
        options={ACTIVITIES.map((a) => ({ value: a, title: t(`target.activity_${a}`), text: t(`target.activityText_${a}`) }))}
        value={activity}
        onChange={changed(setActivity)}
      />
      <p className="-mt-3 text-sm text-muted">{t('target.activityNote')}</p>

      <ChoiceCards
        name="goal"
        legend={t('target.goalLegend')}
        options={GOALS.map((g) => ({ value: g, title: t(`target.goal_${g}`), text: t(`target.goalText_${g}`) }))}
        value={goal}
        onChange={(g) => {
          changed(setGoal)(g)
          setPace('')
        }}
      />
      {goal && !hasPace(goal) && <GoalGuidance goal={goal} />}
      {goal && hasPace(goal) && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t('target.paceLegend')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {paceOptions.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={pace === String(p)}
                onClick={() => changed(setPace)(String(p))}
                className={`flex min-h-14 flex-col items-center justify-center rounded-xl border-2 px-2 ${
                  pace === String(p) ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line bg-card'
                }`}
              >
                <span className="font-semibold">{t('target.pacePercent', { pace: formatDecimal(p) })}</span>
                {weightKg !== null && (
                  <span className="text-xs text-muted">{t('target.paceKg', { kg: formatDecimal(Math.round(weightKg * p) / 100) })}</span>
                )}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <Segmented
        legend={t('target.specialLegend')}
        options={[
          { value: 'no', label: t('target.specialNo') },
          { value: 'yes', label: t('target.specialYes') },
        ]}
        value={special}
        onChange={changed(setSpecial)}
      />

      <StartDateField value={validFrom} onChange={changed(setValidFrom)} />

      <FormError message={error ?? (save.isError ? errorMessage(save.error) : null)} />
      {!result && (
        <Button onClick={() => void calculate()} disabled={pending}>
          {pending ? t('target.calculating') : t('target.calculate')}
        </Button>
      )}

      {result && !result.supported && (
        <Card>
          <h2 className="font-semibold">{t('target.unsupportedTitle')}</h2>
          <p className="mt-1 text-sm">{t(`target.unsupported_${result.reason}`, { floor: result.floor })}</p>
          <div className="mt-4">
            <Button variant="ghost" onClick={onManual}>
              {t('target.enterOwn')}
            </Button>
          </div>
        </Card>
      )}

      {result?.supported && (
        <Card>
          <p className="text-sm font-medium text-muted">{t('target.proposal')}</p>
          <p className="text-3xl font-bold tabular-nums">
            {formatDecimal(result.kcal)} <span className="text-base font-medium text-muted">{t('target.kcalPerDay')}</span>
          </p>
          <div className="mt-3">
            <TargetExplanation
              kcal={result.kcal}
              protein={result.protein_g}
              carbs={result.carbs_g}
              fat={result.fat_g}
              inputs={result.inputs}
              explanation={result.explanation}
            />
          </div>
          <p className="mt-3 rounded-xl bg-brand-soft p-3 text-sm text-brand-dark">{t('target.estimateNote')}</p>
          <p className="mt-2 text-xs text-muted">{t('target.methodNote', { method: result.method })}</p>
          <div className="mt-4 flex flex-col gap-2">
            <Button onClick={accept} disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('target.accept', { date: formatShortDate(validFrom) })}
            </Button>
            <Button variant="ghost" onClick={onManual}>
              {t('target.enterOwn')}
            </Button>
          </div>
        </Card>
      )}
    </>
  )
}

function ManualTargetForm() {
  const { t } = useTranslation()
  const [values, setValues] = useState({ kcal: '', protein_g: '', carbs_g: '', fat_g: '' })
  const [validFrom, setValidFrom] = useState(toISODate(new Date()))
  const [error, setError] = useState<string | null>(null)
  const { save, submit } = useSaveAndReturn()

  const fields: [keyof typeof values, string][] = [
    ['kcal', t('target.kcalField')],
    ['protein_g', `${t('nutrition.protein')} (g)`],
    ['carbs_g', `${t('nutrition.carbs')} (g)`],
    ['fat_g', `${t('nutrition.fat')} (g)`],
  ]

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const whole = (text: string): number | null | undefined => {
      if (!text.trim()) return null
      return /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined
    }
    const parsed = Object.fromEntries(fields.map(([f]) => [f, whole(values[f])])) as Record<keyof typeof values, number | null | undefined>
    const bad = fields.find(([f]) => parsed[f] === undefined)
    if (bad) return setError(t('target.errors.wholeNumber', { field: bad[1] }))
    if (!parsed.kcal) return setError(t('target.errors.kcal'))
    submit(validFrom, {
      mode: 'manual',
      kcal: parsed.kcal,
      protein_g: parsed.protein_g ?? null,
      carbs_g: parsed.carbs_g ?? null,
      fat_g: parsed.fat_g ?? null,
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
      <p className="text-sm text-muted">{t('target.manualIntro')}</p>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([field, label]) => (
          <Field
            key={field}
            label={label}
            name={field}
            inputMode="numeric"
            value={values[field]}
            onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
          />
        ))}
      </div>
      <StartDateField value={validFrom} onChange={setValidFrom} />
      <FormError message={error ?? (save.isError ? errorMessage(save.error) : null)} />
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? t('common.saving') : t('target.saveManual')}
      </Button>
    </form>
  )
}
