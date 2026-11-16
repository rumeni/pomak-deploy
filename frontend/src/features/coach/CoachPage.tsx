import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { LanguageMenu } from '../../components/LanguageMenu'
import { Button, Card, EmptyState, Field, FormError, PageHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { getFormatLocale } from '../../lib/format'
import { CoachMessages } from './CoachMessages'
import {
  useCoachDashboard, useConnectCoach, useCreateCoachInvite, useDisconnectCoach,
  useRevokeCoachInvite, useUpdateCoachSharing, type Connection,
} from './api'

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

export function CoachPage() {
  const { t } = useTranslation()
  const dashboard = useCoachDashboard()
  return (
    <>
      <PageHeader title={t('coach.title')} action={<LanguageMenu />} />
      <div className="flex flex-col gap-3 px-4 pb-8">
        {dashboard.isLoading && <p className="text-muted">{t('common.loading')}</p>}
        {dashboard.isError && (
          <Card><FormError message={t('errors.loadFailed')} /><Button variant="secondary" onClick={() => void dashboard.refetch()}>{t('common.retry')}</Button></Card>
        )}
        {dashboard.data?.role === 'coach' && <CoachWorkspace invitations={dashboard.data.invitations} clients={dashboard.data.clients} />}
        {dashboard.data?.role === 'client' && <ClientWorkspace connection={dashboard.data.connection} assignments={dashboard.data.assignments} />}
      </div>
    </>
  )
}

function CoachWorkspace({ invitations, clients }: {
  invitations: { id: string; code: string; expires_at: string }[]
  clients: Connection[]
}) {
  const { t } = useTranslation()
  const createInvite = useCreateCoachInvite()
  const revoke = useRevokeCoachInvite()
  return (
    <>
      <Card title={t('coach.inviteTitle')}>
        <p className="mb-3 text-sm text-muted">{t('coach.inviteDescription')}</p>
        {invitations.map((invite) => (
          <div key={invite.id} className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3">
            <div>
              <code className="block select-all font-semibold tracking-wide">{invite.code}</code>
              <p className="text-xs text-muted">{t('coach.expires', { date: dateLabel(invite.expires_at) })}</p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(invite.code)}>
                {t('coach.copy')}
              </Button>
              <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(invite.id)}>
                {t('coach.revoke')}
              </Button>
            </div>
          </div>
        ))}
        <FormError message={createInvite.error ? errorMessage(createInvite.error) : revoke.error ? errorMessage(revoke.error) : null} />
        <Button className="mt-3 w-full" disabled={createInvite.isPending || invitations.length >= 5} onClick={() => createInvite.mutate()}>
          {t('coach.createInvite')}
        </Button>
      </Card>
      <Card title={t('coach.clientsTitle')}>
        {clients.length === 0 && <p className="text-muted">{t('coach.noClients')}</p>}
        <div className="flex flex-col gap-2">
          {clients.map((connection) => (
            <Link key={connection.id} to={`/trener/klijenti/${connection.client.id}`} className="flex min-h-14 items-center justify-between rounded-xl border border-line px-3 py-2 active:bg-brand-soft">
              <span className="font-semibold">{connection.client.name}</span>
              <span className="text-sm text-muted">{t('coach.openClient')} ›</span>
            </Link>
          ))}
        </div>
      </Card>
    </>
  )
}

function SharingOptions({ values, onChange }: {
  values: { share_measurements: boolean; share_nutrition: boolean }
  onChange: (values: { share_measurements: boolean; share_nutrition: boolean }) => void
}) {
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
      <p className="text-xs text-muted">{t('coach.shareTrainingNotice')}</p>
    </fieldset>
  )
}

function ClientWorkspace({ connection, assignments }: { connection: Connection | null; assignments: { id: string; name: string; routine_id: string }[] }) {
  const { t } = useTranslation()
  const disconnect = useDisconnectCoach()
  const connect = useConnectCoach()
  const [code, setCode] = useState('')
  // Until the invite is accepted, the client can choose initial sharing flags.
  const [sharing, setSharing] = useState({ share_measurements: false, share_nutrition: false })
  const onConnect = (e: FormEvent) => {
    e.preventDefault()
    connect.mutate({ code: code.trim().toUpperCase(), ...sharing })
  }

  if (!connection) {
    return (
      <>
        <EmptyState title={t('coach.noCoachTitle')} text={t('coach.noCoachText')} />
        <Card title={t('coach.enterInvite')}>
          <form className="flex flex-col gap-3" onSubmit={onConnect}>
            <Field label={t('coach.inviteCode')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={16} autoCapitalize="characters" autoComplete="off" placeholder="ABCD1234EF567890" required />
            <SharingOptions values={sharing} onChange={setSharing} />
            <FormError message={connect.error ? errorMessage(connect.error) : null} />
            <Button disabled={connect.isPending || code.trim().length !== 16}>{t('coach.connect')}</Button>
          </form>
        </Card>
      </>
    )
  }
  return (
    <>
      <Card title={t('coach.myCoach')}>
        <p className="mb-3 text-lg font-semibold">{connection.coach.name}</p>
        <p className="mb-3 text-sm text-muted">{t('coach.connectedAt', { date: dateLabel(connection.connected_at) })}</p>
        <ConnectedSharingSettings
          key={`${connection.id}:${connection.share_measurements}:${connection.share_nutrition}`}
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
      <Card title={t('coach.assignedRoutines')}>
        {assignments.length === 0 && <p className="text-muted">{t('coach.noAssignments')}</p>}
        {assignments.map((assignment) => (
          <Link key={assignment.id} to={`/trening/rutine/${assignment.routine_id}`} className="block rounded-xl border border-line px-4 py-3 font-semibold active:bg-brand-soft">
            {assignment.name} ›
          </Link>
        ))}
        <p className="mt-2 text-xs text-muted">{t('coach.routinesInTraining')}</p>
      </Card>
      <CoachMessages key={connection.id} selfId={connection.client.id} />
    </>
  )
}


/** Keyed by the server's consent values so even A → B → A polls cannot reuse an old draft. */
function ConnectedSharingSettings({ connection }: { connection: Connection }) {
  const { t } = useTranslation()
  const updateSharing = useUpdateCoachSharing()
  const [sharing, setSharing] = useState({
    share_measurements: connection.share_measurements,
    share_nutrition: connection.share_nutrition,
  })
  return (
    <>
      <SharingOptions values={sharing} onChange={setSharing} />
      <Button className="mt-3 w-full" variant="secondary" disabled={updateSharing.isPending} onClick={() => updateSharing.mutate(sharing)}>{t('coach.saveSharing')}</Button>
      <FormError message={updateSharing.error ? errorMessage(updateSharing.error) : null} />
    </>
  )
}
