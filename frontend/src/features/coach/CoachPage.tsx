import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { LanguageMenu } from '../../components/LanguageMenu'
import coachPhoto from '../../assets/photos/coach.webp'
import { Button, Card, EmptyState, Field, FormError, PageHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { getFormatLocale } from '../../lib/format'
import { CoachCardView } from './CoachCardView'
import { CoachMessages } from './CoachMessages'
import { MyPlanCard } from './MyPlanCard'
import {
  useCoachDashboard, useConnectCoach, useDisconnectCoach, useInvitePreview, useUpdateCoachSharing,
  type CoachAssignment, type CoachCard, type CoachNote, type Connection, type Sharing,
} from './api'
import { normalizeInviteCode } from './workspace'

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The client's Coach tab: connect (seeing who the coach is first), or the collaboration. */
export function CoachPage() {
  const { t } = useTranslation()
  const dashboard = useCoachDashboard()
  const data = dashboard.data?.role === 'client' ? dashboard.data : null
  return (
    <>
      <PageHeader title={t('coach.title')} photo={coachPhoto} action={<LanguageMenu />} />
      <div className="flex flex-col gap-3 px-4 pb-8">
        {dashboard.isLoading && <p className="text-muted">{t('common.loading')}</p>}
        {dashboard.isError && !dashboard.data && (
          <Card><FormError message={t('errors.loadFailed')} /><Button variant="secondary" onClick={() => void dashboard.refetch()}>{t('common.retry')}</Button></Card>
        )}
        {data && (data.connection
          ? <Collaboration connection={data.connection} coach={data.coach ?? null} notes={data.shared_notes ?? []} assignments={data.assignments} />
          : <ConnectFlow />)}
        {data && (data.archived?.length ?? 0) > 0 && <PastCollaborations rows={data.archived!} />}
      </div>
    </>
  )
}

function SharingOptions({ values, onChange }: { values: Sharing; onChange: (values: Sharing) => void }) {
  const { t } = useTranslation()
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-3">
      <legend className="px-1 text-sm font-semibold">{t('coach.sharingTitle')}</legend>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={values.share_measurements} onChange={(e) => onChange({ ...values, share_measurements: e.target.checked })} className="size-5 accent-brand" />
        {t('coach.shareMeasurements')}
      </label>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={values.share_nutrition} onChange={(e) => onChange({ ...values, share_nutrition: e.target.checked })} className="size-5 accent-brand" />
        {t('coach.shareNutrition')}
      </label>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={values.share_readiness} onChange={(e) => onChange({ ...values, share_readiness: e.target.checked })} className="size-5 accent-brand" />
        {t('coach.shareReadiness')}
      </label>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={values.coach_sets_nutrition} onChange={(e) => onChange({ ...values, coach_sets_nutrition: e.target.checked })} className="size-5 accent-brand" />
        {t('coach.coachSetsNutrition')}
      </label>
      <p className="text-xs text-muted">{t('coach.shareTrainingNotice')}</p>
    </fieldset>
  )
}

/** Code (typed, or from an invite link) → who the coach is → what to share → accept. */
function ConnectFlow() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const fromLink = normalizeInviteCode(params.get('kod') ?? '')
  const [code, setCode] = useState(fromLink ?? '')
  const [checking, setChecking] = useState<string | null>(fromLink)
  const preview = useInvitePreview(checking)
  const connect = useConnectCoach()
  const [sharing, setSharing] = useState<Sharing>({ share_measurements: false, share_nutrition: false, share_readiness: false, coach_sets_nutrition: false })

  const onCheck = (e: FormEvent) => {
    e.preventDefault()
    setChecking(normalizeInviteCode(code))
  }
  const cancel = () => {
    setChecking(null)
    if (params.has('kod')) setParams({}, { replace: true })
  }

  if (checking && preview.data) {
    return (
      <Card title={t('coachSpace.connect.whoTitle')}>
        <CoachCardView coach={preview.data.coach} />
        <div className="mt-4 flex flex-col gap-3">
          <SharingOptions values={sharing} onChange={setSharing} />
          <FormError message={connect.error ? errorMessage(connect.error) : null} />
          <Button disabled={connect.isPending} onClick={() => connect.mutate({ code: checking, ...sharing }, {
            onSuccess: () => { if (params.has('kod')) setParams({}, { replace: true }) },
          })}>{t('coach.connect')}</Button>
          <Button variant="ghost" onClick={cancel}>{t('coachSpace.connect.notNow')}</Button>
        </div>
      </Card>
    )
  }
  return (
    <>
      <EmptyState title={t('coach.noCoachTitle')} text={t('coach.noCoachText')} />
      <Card title={t('coach.enterInvite')}>
        <form className="flex flex-col gap-3" onSubmit={onCheck}>
          <Field label={t('coach.inviteCode')} name="invite-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={16} autoCapitalize="characters" autoComplete="off" placeholder="ABCD1234EF567890" required />
          <FormError message={checking && preview.error ? errorMessage(preview.error) : null} />
          <Button disabled={preview.isFetching || !normalizeInviteCode(code)}>{preview.isFetching ? t('common.loading') : t('coachSpace.connect.check')}</Button>
          <p className="text-xs text-muted">{t('coachSpace.connect.checkHint')}</p>
        </form>
      </Card>
    </>
  )
}

function Collaboration({ connection, coach, notes, assignments }: {
  connection: Connection
  coach: CoachCard | null
  notes: CoachNote[]
  assignments: CoachAssignment[]
}) {
  const { t } = useTranslation()
  const disconnect = useDisconnectCoach()
  return (
    <>
      <Card title={t('coach.myCoach')}>
        {coach ? <CoachCardView coach={coach} /> : <p className="text-lg font-semibold">{connection.coach.name}</p>}
        <p className="mt-3 text-sm text-muted">{t('coach.connectedAt', { date: dateLabel(connection.connected_at) })}</p>
      </Card>
      {notes.length > 0 && (
        <Card title={t('coachSpace.connect.notesFromCoach')}>
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id} className="rounded-xl bg-brand-soft/50 p-3 text-sm">
                <p className="whitespace-pre-wrap">{note.text}</p>
                <p className="mt-1 text-xs text-muted">{dateLabel(note.created_at)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <MyPlanCard />
      <Card title={t('coach.assignedRoutines')}>
        {assignments.length === 0 && <p className="text-muted">{t('coach.noAssignments')}</p>}
        {assignments.map((assignment) => (
          <Link key={assignment.id} to={`/trening/rutine/${assignment.routine_id}`} className="block rounded-xl border border-line px-4 py-3 font-semibold active:bg-brand-soft">
            {assignment.name} ›
          </Link>
        ))}
        <p className="mt-2 text-xs text-muted">{t('coach.routinesInTraining')}</p>
      </Card>
      <CoachMessages key={connection.id} selfId={connection.client.id} workoutLink={(w) => `/trening/istorija/${w}`} />
      <Card title={t('coach.sharingTitle')}>
        <ConnectedSharingSettings
          key={`${connection.id}:${connection.access_version ?? 0}:${connection.share_measurements}:${connection.share_nutrition}:${connection.share_readiness}:${connection.coach_sets_nutrition}`}
          connection={connection}
        />
        <p className="mt-2 text-xs text-muted">{t('coach.revokeAnytime')}</p>
        <Button variant="ghost" className="mt-3 w-full text-danger" disabled={disconnect.isPending} onClick={() => {
          if (window.confirm(t('coach.disconnectConfirm'))) disconnect.mutate(undefined)
        }}>
          {t('coach.disconnect')}
        </Button>
        <FormError message={disconnect.error ? errorMessage(disconnect.error) : null} />
      </Card>
    </>
  )
}

function PastCollaborations({ rows }: { rows: Connection[] }) {
  const { t } = useTranslation()
  return (
    <Card title={t('coachSpace.connect.past')}>
      <ul className="flex flex-col gap-2">
        {rows.map((c) => (
          <li key={c.id}>
            <Link to={`/trener/arhiva/${c.id}`} className="flex min-h-12 items-center justify-between rounded-xl border border-line px-4 active:bg-brand-soft">
              <span>
                <span className="block font-semibold">{c.coach.name}</span>
                <span className="block text-xs text-muted">{t('coachSpace.clients.endedOn', { date: c.ended_at ? dateLabel(c.ended_at) : '' })}</span>
              </span>
              <span className="text-muted" aria-hidden>›</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Keyed by the server's consent values so even A → B → A polls cannot reuse an old draft. */
function ConnectedSharingSettings({ connection }: { connection: Connection }) {
  const { t } = useTranslation()
  const updateSharing = useUpdateCoachSharing()
  const [sharing, setSharing] = useState<Sharing>({
    share_measurements: connection.share_measurements,
    share_nutrition: connection.share_nutrition,
    share_readiness: connection.share_readiness ?? false,
    coach_sets_nutrition: connection.coach_sets_nutrition ?? false,
  })
  return (
    <>
      <SharingOptions values={sharing} onChange={setSharing} />
      <Button className="mt-3 w-full" variant="secondary" disabled={updateSharing.isPending} onClick={() => updateSharing.mutate(sharing)}>{t('coach.saveSharing')}</Button>
      <FormError message={updateSharing.error ? errorMessage(updateSharing.error) : null} />
    </>
  )
}
