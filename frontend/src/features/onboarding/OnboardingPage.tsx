import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { DateOfBirthField } from '../../components/DateOfBirthField'
import { Button, ChoiceCards, Field, FormError, Segmented } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { acceptsProfileResponse, patchOwnProfile, profileScope } from '../../lib/profileMutation'
import { useAuth } from '../../lib/auth'
import { formatDecimal, parseDecimal, toISODate } from '../../lib/format'
import type { Me, Profile } from '../../lib/types'
import { uuid } from '../../lib/uuid'
import { LanguageMenu } from '../../components/LanguageMenu'

type Tracking = 'training' | 'nutrition' | 'both'
type Step = 'tracking' | 'body' | 'training'

/**
 * Početno podešavanje posle registracije. Svaki korak se čuva odmah, pa zatvaranje
 * aplikacije usred podešavanja ne briše već unete podatke.
 */
export function OnboardingPage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('tracking')
  const [tracking, setTracking] = useState<Tracking>('both')

  const saveProfile = async (profile: Partial<Profile>) => {
    if (!me) throw new Error('Authentication changed')
    const data = await patchOwnProfile(me.id, profile)
    if (!data) throw new Error('Authentication changed')
    queryClient.setQueryData(['me'], data)
  }

  const finish = useMutation({
    mutationFn: async (ownerId: string) => {
      const scope = profileScope(ownerId)
      const { data } = await api.post<Me>('/auth/me/onboarding/complete/', {}, { __pomakScope: scope })
      return { data, scope }
    },
    onSuccess: ({ data, scope }) => {
      if (acceptsProfileResponse(scope, data)) queryClient.setQueryData(['me'], data)
    },
  })

  const tracksTraining = tracking !== 'nutrition'
  const steps: Step[] = tracksTraining ? ['tracking', 'body', 'training'] : ['tracking', 'body']
  const position = steps.indexOf(step) + 1

  const next = () => {
    const following = steps[steps.indexOf(step) + 1]
    if (following) setStep(following)
    else if (me) finish.mutate(me.id)
  }

  return (
    <div className="pt-safe pb-safe flex min-h-full">
      <main className="mx-auto flex w-full max-w-md flex-col px-5 py-8">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand">
            {t('onboarding.stepOf', { current: position, total: steps.length })}
          </p>
          <LanguageMenu />
        </div>
        {step === 'tracking' && (
          <TrackingStep
            value={tracking}
            onChange={setTracking}
            onSubmit={async () => {
              await saveProfile({ tracks_training: tracking !== 'nutrition', tracks_nutrition: tracking !== 'training' })
              next()
            }}
          />
        )}
        {step === 'body' && me && (
          <BodyStep profile={me.profile} forNutrition={tracking !== 'training'} saveProfile={saveProfile} onDone={next} />
        )}
        {step === 'training' && me && <TrainingStep profile={me.profile} saveProfile={saveProfile} onDone={next} />}
        <FormError message={finish.isError ? errorMessage(finish.error) : null} />
      </main>
    </div>
  )
}

function StepLayout({ title, text, children, actions }: { title: string; text: string; children: ReactNode; actions: ReactNode }) {
  return (
    <>
      <h1 className="mt-2 text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-muted">{text}</p>
      <div className="mt-6 flex flex-col gap-4">{children}</div>
      <div className="mt-auto flex flex-col gap-3 pt-8">{actions}</div>
    </>
  )
}

/** Greška u unosu; nosi ključ prevoda poruke (npr. onboarding.invalidHeight). */
class InputError extends Error {}

function useStepSubmit(action: () => Promise<void>) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const run = async () => {
    setError(null)
    setPending(true)
    try {
      await action()
    } catch (e) {
      setError(e instanceof InputError ? t(e.message) : errorMessage(e))
    } finally {
      setPending(false)
    }
  }
  return { run, error, pending }
}

function StepActions({
  submit,
  submitLabel,
  onSkip,
}: {
  submit: ReturnType<typeof useStepSubmit>
  submitLabel: string
  onSkip?: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <FormError message={submit.error} />
      <Button onClick={submit.run} disabled={submit.pending}>
        {submit.pending ? t('common.saving') : submitLabel}
      </Button>
      {onSkip && (
        <Button variant="ghost" onClick={onSkip} disabled={submit.pending}>
          {t('common.skipForNow')}
        </Button>
      )}
    </>
  )
}

function TrackingStep({ value, onChange, onSubmit }: { value: Tracking; onChange: (v: Tracking) => void; onSubmit: () => Promise<void> }) {
  const { t } = useTranslation()
  const submit = useStepSubmit(onSubmit)
  const options: { value: Tracking; title: string; text: string }[] = [
    { value: 'both', title: t('onboarding.trackBoth'), text: t('onboarding.trackBothText') },
    { value: 'training', title: t('onboarding.trackTraining'), text: t('onboarding.trackTrainingText') },
    { value: 'nutrition', title: t('onboarding.trackNutrition'), text: t('onboarding.trackNutritionText') },
  ]
  return (
    <StepLayout
      title={t('onboarding.trackingTitle')}
      text={t('onboarding.trackingText')}
      actions={<StepActions submit={submit} submitLabel={t('common.continue')} />}
    >
      <ChoiceCards name="tracking" legend={t('onboarding.trackingLegend')} options={options} value={value} onChange={onChange} />
    </StepLayout>
  )
}

function BodyStep({
  profile,
  forNutrition,
  saveProfile,
  onDone,
}: {
  profile: Profile
  forNutrition: boolean
  saveProfile: (p: Partial<Profile>) => Promise<void>
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [sex, setSex] = useState<Profile['sex']>(profile.sex)
  const [birthDate, setBirthDate] = useState(profile.birth_date ?? '')
  const [height, setHeight] = useState(profile.height_cm ? formatDecimal(Number(profile.height_cm)) : '')
  const [weight, setWeight] = useState('')
  // Isti ID pri ponovnom pokušaju: server neće upisati težinu dva puta.
  const weightId = useRef(uuid())

  const submit = useStepSubmit(async () => {
    const heightCm = height ? parseDecimal(height) : null
    const weightKg = weight ? parseDecimal(weight) : null
    if (height && heightCm === null) throw new InputError('onboarding.invalidHeight')
    if (weight && weightKg === null) throw new InputError('onboarding.invalidWeight')

    await saveProfile({ sex, birth_date: birthDate || null, height_cm: heightCm === null ? null : String(heightCm) })
    if (weightKg !== null) {
      await api.post('/progress/measurements/', {
        id: weightId.current,
        kind: 'weight',
        value: String(weightKg),
        measured_on: toISODate(new Date()),
      })
    }
    onDone()
  })

  return (
    <StepLayout
      title={t('onboarding.bodyTitle')}
      text={forNutrition ? t('onboarding.bodyTextNutrition') : t('onboarding.bodyTextTraining')}
      actions={<StepActions submit={submit} submitLabel={t('common.continue')} onSkip={onDone} />}
    >
      <Segmented
        legend={t('onboarding.sex')}
        options={[
          { value: 'male', label: t('onboarding.male') },
          { value: 'female', label: t('onboarding.female') },
        ]}
        value={sex}
        onChange={setSex}
      />
      <DateOfBirthField value={birthDate} onChange={setBirthDate} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('onboarding.heightCm')} name="height" inputMode="decimal" placeholder={t('onboarding.heightExample')} value={height} onChange={(e) => setHeight(e.target.value)} />
        <Field label={t('onboarding.weightKg')} name="weight" inputMode="decimal" placeholder={t('onboarding.weightExample')} value={weight} onChange={(e) => setWeight(e.target.value)} />
      </div>
    </StepLayout>
  )
}

function TrainingStep({
  profile,
  saveProfile,
  onDone,
}: {
  profile: Profile
  saveProfile: (p: Partial<Profile>) => Promise<void>
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [experience, setExperience] = useState<Profile['training_experience']>(profile.training_experience)
  const [perWeek, setPerWeek] = useState(profile.weekly_workouts_target ? String(profile.weekly_workouts_target) : '')

  const submit = useStepSubmit(async () => {
    await saveProfile({ training_experience: experience, weekly_workouts_target: perWeek ? Number(perWeek) : null })
    onDone()
  })

  return (
    <StepLayout
      title={t('onboarding.trainingTitle')}
      text={t('onboarding.trainingText')}
      actions={<StepActions submit={submit} submitLabel={t('onboarding.finish')} onSkip={onDone} />}
    >
      <Segmented
        legend={t('onboarding.experience')}
        options={[
          { value: 'beginner', label: t('onboarding.beginner') },
          { value: 'intermediate', label: t('onboarding.intermediate') },
          { value: 'advanced', label: t('onboarding.advanced') },
        ]}
        value={experience}
        onChange={setExperience}
      />
      <Segmented
        legend={t('onboarding.perWeek')}
        options={['2', '3', '4', '5', '6'].map((n) => ({ value: n, label: n }))}
        value={perWeek}
        onChange={setPerWeek}
      />
    </StepLayout>
  )
}
