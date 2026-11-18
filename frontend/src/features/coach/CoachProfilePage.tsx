import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { Button, Card, ChoiceCards, Field, FormError, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { PictureError, shrinkPicture, useCoachPhoto } from './pictures'
import { useCoachProfile, useSaveCoachProfile, type CoachCard, type CoachProfile, type CoachProfileInput, type Specialty, type WorkMode } from './api'
import { CoachCardView } from './CoachCardView'

type Draft = {
  years_experience: string
  specialties: Specialty[]
  work_mode: WorkMode | ''
  gym_name: string
  city: string
  address: string
  qualifications: string
  bio: string
}

function toDraft(p: CoachProfile): Draft {
  return {
    years_experience: p.years_experience == null ? '' : String(p.years_experience),
    specialties: p.specialties,
    work_mode: p.work_mode,
    gym_name: p.gym_name,
    city: p.city,
    address: p.address,
    qualifications: p.qualifications,
    bio: p.bio,
  }
}

function draftCard(d: Draft): Omit<CoachCard, 'id' | 'name'> {
  const input = toInput(d)
  return {
    years_experience: input.years_experience ?? null,
    specialties: d.specialties,
    work_mode: d.work_mode,
    gym_name: input.gym_name ?? '',
    city: input.city ?? '',
    address: input.address ?? '',
    qualifications: input.qualifications ?? '',
    bio: input.bio ?? '',
  }
}

function toInput(d: Draft): CoachProfileInput {
  const years = d.years_experience.trim() === '' ? null : Number(d.years_experience)
  return {
    years_experience: years != null && Number.isInteger(years) && years >= 0 ? years : null,
    specialties: d.specialties,
    work_mode: d.work_mode,
    gym_name: d.gym_name.trim(),
    city: d.city.trim(),
    address: d.address.trim(),
    qualifications: d.qualifications.trim(),
    bio: d.bio.trim(),
  }
}

/**
 * The coach's starting questions (three short steps, shown once) and, later, the same answers
 * as an editable profile. This is what a client sees before accepting an invitation.
 */
/** The coach's own picture: shrunk on the device, re-encoded on the server, shown on his card. */
function PhotoControls({ hasPhoto }: { hasPhoto: boolean }) {
  const { t } = useTranslation()
  const { upload, remove } = useCoachPhoto()
  const [error, setError] = useState<string | null>(null)
  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      upload.mutate(await shrinkPicture(file, 1024))
    } catch (e) {
      setError(e instanceof PictureError ? t(e.message) : errorMessage(e))
    }
  }
  const busy = upload.isPending || remove.isPending
  return (
    <div className="mt-3 flex flex-col gap-2">
      <FormError message={error ?? (upload.error ? errorMessage(upload.error) : remove.error ? errorMessage(remove.error) : null)} />
      <div className="flex flex-wrap gap-2">
        <label className={`app-button inline-flex min-h-10 cursor-pointer items-center bg-brand-soft px-4 text-sm text-brand-dark ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          {upload.isPending ? t('common.saving') : hasPhoto ? t('coachSpace.profile.changePhoto') : t('coachSpace.profile.addPhoto')}
          <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {hasPhoto && <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => remove.mutate()}>{t('coachSpace.profile.removePhoto')}</Button>}
      </div>
    </div>
  )
}

export function CoachProfilePage({ onboarding = false }: { onboarding?: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const profile = useCoachProfile()
  if (profile.isLoading) return <p className="p-6 text-muted">{t('common.loading')}</p>
  if (profile.isError || !profile.data) {
    return (
      <div className="p-4">
        <Card>
          <FormError message={t('errors.loadFailed')} />
          <Button variant="secondary" className="mt-3" onClick={() => void profile.refetch()}>{t('common.retry')}</Button>
        </Card>
      </div>
    )
  }
  return onboarding || !profile.data.completed_at
    ? <Wizard profile={profile.data} onDone={() => navigate('/trener', { replace: true })} />
    : <EditProfile profile={profile.data} />
}

const STEPS = 3

function Wizard({ profile, onDone }: { profile: CoachProfile; onDone: () => void }) {
  const { t } = useTranslation()
  const save = useSaveCoachProfile()
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState(() => toDraft(profile))
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const stepError = (): string | null => {
    const input = toInput(draft)
    if (step === 0 && input.years_experience == null) return t('coachSpace.profile.errors.years')
    if (step === 0 && !draft.specialties.length) return t('coachSpace.profile.errors.specialties')
    if (step === 1 && !draft.work_mode) return t('coachSpace.profile.errors.workMode')
    if (step === 1 && draft.work_mode !== 'online' && !draft.city.trim()) return t('coachSpace.profile.errors.city')
    return null
  }

  const next = (event: FormEvent) => {
    event.preventDefault()
    const problem = stepError()
    setError(problem)
    if (problem) return
    if (step < STEPS - 1) return setStep(step + 1)
    save.mutate({ ...toInput(draft), complete: true }, { onSuccess: onDone })
  }

  return (
    <main className="pt-safe mx-auto flex min-h-full max-w-md flex-col gap-4 px-5 py-6">
      <div>
        <p className="text-sm font-semibold text-muted">{t('coachSpace.profile.step', { current: step + 1, total: STEPS })}</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{t(`coachSpace.profile.wizard.${step}.title`)}</h1>
        <p className="mt-1 text-muted">{t(`coachSpace.profile.wizard.${step}.text`)}</p>
      </div>
      <form className="flex flex-col gap-4" onSubmit={next} noValidate>
        {step === 0 && <ExperienceFields draft={draft} set={set} />}
        {step === 1 && <WhereFields draft={draft} set={set} />}
        {step === 2 && <AboutFields draft={draft} set={set} />}
        <FormError message={error ?? (save.error ? errorMessage(save.error) : null)} />
        <div className="flex gap-2">
          {step > 0 && <Button type="button" variant="secondary" onClick={() => { setError(null); setStep(step - 1) }}>{t('common.back')}</Button>}
          <Button className="flex-1" disabled={save.isPending}>
            {step < STEPS - 1 ? t('common.continue') : save.isPending ? t('common.saving') : t('coachSpace.profile.finish')}
          </Button>
        </div>
      </form>
    </main>
  )
}

function EditProfile({ profile }: { profile: CoachProfile }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const save = useSaveCoachProfile()
  const [draft, setDraft] = useState(() => toDraft(profile))
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate(toInput(draft))
  }
  return (
    <div className="min-h-full pb-12">
      <ScreenHeader title={t('coachSpace.profile.title')} onBack={() => navigate('/trener')} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-4">
        <Card title={t('coachSpace.profile.preview')}>
          <p className="mb-3 text-sm text-muted">{t('coachSpace.profile.previewHint')}</p>
          <CoachCardView coach={{ id: profile.id ?? '', name: profile.name, ...draftCard(draft), photo: profile.photo ?? null }} />
          <PhotoControls hasPhoto={!!profile.photo} />
        </Card>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <Card><div className="flex flex-col gap-4"><ExperienceFields draft={draft} set={set} /></div></Card>
          <Card><div className="flex flex-col gap-4"><WhereFields draft={draft} set={set} /></div></Card>
          <Card><div className="flex flex-col gap-4"><AboutFields draft={draft} set={set} /></div></Card>
          <FormError message={save.error ? errorMessage(save.error) : null} />
          {save.isSuccess && !save.isPending && <p role="status" className="text-sm text-brand-dark">{t('coachSpace.profile.saved')}</p>}
          <Button disabled={save.isPending}>{save.isPending ? t('common.saving') : t('common.save')}</Button>
        </form>
        <Link to="/profil" className="app-card flex items-center justify-between !p-4 font-semibold">
          {t('coachSpace.profile.account')} <span className="text-muted" aria-hidden>›</span>
        </Link>
      </div>
    </div>
  )
}

type FieldsProps = { draft: Draft; set: (patch: Partial<Draft>) => void }

const SPECIALTIES: Specialty[] = ['strength', 'hypertrophy', 'weight_loss', 'general_fitness', 'beginners', 'mobility', 'injury_recovery', 'sport', 'seniors', 'women']

function ExperienceFields({ draft, set }: FieldsProps) {
  const { t } = useTranslation()
  return (
    <>
      <Field
        label={t('coachSpace.profile.years')}
        name="years_experience"
        type="number"
        inputMode="numeric"
        min={0}
        max={60}
        value={draft.years_experience}
        onChange={(e) => set({ years_experience: e.target.value.replace(/[^\d]/g, '').slice(0, 2) })}
      />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t('coachSpace.profile.specialties')}</legend>
        <div className="flex flex-wrap gap-2">
          {SPECIALTIES.map((value) => {
            const on = draft.specialties.includes(value)
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() => set({ specialties: on ? draft.specialties.filter((s) => s !== value) : [...draft.specialties, value] })}
                className={`min-h-11 rounded-full border-2 px-4 text-sm font-medium ${on ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line bg-card'}`}
              >
                {t(`coachSpace.specialty.${value}`)}
              </button>
            )
          })}
        </div>
      </fieldset>
    </>
  )
}

function WhereFields({ draft, set }: FieldsProps) {
  const { t } = useTranslation()
  return (
    <>
      <ChoiceCards<WorkMode>
        name="work_mode"
        legend={t('coachSpace.profile.workMode')}
        value={draft.work_mode}
        onChange={(work_mode) => set({ work_mode })}
        options={(['in_person', 'online', 'both'] as const).map((value) => ({ value, title: t(`coachSpace.workMode.${value}`) }))}
      />
      <Field label={`${t('coachSpace.profile.gym')} (${t('common.optional')})`} name="gym_name" maxLength={120} value={draft.gym_name} onChange={(e) => set({ gym_name: e.target.value })} />
      <Field
        label={draft.work_mode === 'online' ? `${t('coachSpace.profile.city')} (${t('common.optional')})` : t('coachSpace.profile.city')}
        name="city" maxLength={80} autoComplete="address-level2" value={draft.city} onChange={(e) => set({ city: e.target.value })}
      />
      <Field label={`${t('coachSpace.profile.address')} (${t('common.optional')})`} name="address" maxLength={160} value={draft.address} onChange={(e) => set({ address: e.target.value })} />
    </>
  )
}

function AboutFields({ draft, set }: FieldsProps) {
  const { t } = useTranslation()
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="qualifications" className="text-sm font-medium">{t('coachSpace.profile.qualifications')} ({t('common.optional')})</label>
        <textarea id="qualifications" rows={3} maxLength={500} value={draft.qualifications} onChange={(e) => set({ qualifications: e.target.value })} className="w-full rounded-2xl border border-line bg-card p-3 outline-none focus:border-brand" />
        <p className="text-xs text-muted">{t('coachSpace.profile.qualificationsHint')}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bio" className="text-sm font-medium">{t('coachSpace.profile.bio')} ({t('common.optional')})</label>
        <textarea id="bio" rows={4} maxLength={600} value={draft.bio} onChange={(e) => set({ bio: e.target.value })} className="w-full rounded-2xl border border-line bg-card p-3 outline-none focus:border-brand" />
      </div>
    </>
  )
}
