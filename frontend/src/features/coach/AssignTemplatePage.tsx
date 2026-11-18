import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Button, Card, Field, FormError, ScreenHeader } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { toISODate } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { useCoachDashboard } from './api'
import { nextMonday, planDate } from './plans'
import { useAssignTemplate, useTemplates, type AssignResult } from './plansApi'

type Step = 'template' | 'clients' | 'date'

/** Assigning a program in three steps: program → clients → start date. */
export function AssignTemplatePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const templates = useTemplates()
  const dashboard = useCoachDashboard()
  const assign = useAssignTemplate()
  const preselectedClient = params.get('klijent')
  const [templateId, setTemplateId] = useState(params.get('sablon') ?? '')
  // The collaborations chosen (not clients): a retry never goes to a collaboration made later.
  const [selected, setSelected] = useState<string[]>([])
  const [preselected, setPreselected] = useState(false)
  const [step, setStep] = useState<Step>(params.get('sablon') ? 'clients' : 'template')
  const [startDate, setStartDate] = useState(() => nextMonday(new Date()))
  const [reason, setReason] = useState('')
  // One ID per attempt: a retry after a lost response does not assign twice.
  const [requestId] = useState(() => uuid())
  const [done, setDone] = useState<AssignResult | null>(null)
  const clients = dashboard.data?.role === 'coach' ? dashboard.data.clients : []
  if (!preselected && preselectedClient && clients.length) {
    const row = clients.find((c) => c.client.id === preselectedClient)
    setPreselected(true)
    if (row) setSelected([row.id])
  }
  const template = templates.data?.find((x) => x.id === templateId)
  const today = toISODate(new Date())
  const back = () => (preselectedClient ? navigate(`/trener/klijenti/${preselectedClient}?tab=plan`) : navigate('/trener/programi'))

  if (done) {
    return (
      <div className="min-h-full pb-12">
        <ScreenHeader title={t('coachSpace.assign.title')} onBack={back} />
        <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-4">
          <Card title={t('coachSpace.assign.doneTitle')}>
            <ul className="flex flex-col gap-1 text-sm">
              {done.results.map((r) => (
                <li key={r.connection_id}>{r.ok ? '✓' : '✕'} {r.name ?? clients.find((c) => c.id === r.connection_id)?.client.name ?? '?'}
                  {!r.ok && <span className="text-danger"> · {t('coachSpace.assign.notAssigned')}</span>}</li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted">{t('coachSpace.assign.doneHint', { date: planDate(startDate) })}</p>
          </Card>
          <Button onClick={back}>{t('coachSpace.assign.finish')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full pb-12">
      <ScreenHeader title={t('coachSpace.assign.title')} onBack={back} />
      <div className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-4">
        <ol className="flex gap-2 text-xs font-semibold" aria-label={t('coachSpace.assign.steps')}>
          {(['template', 'clients', 'date'] as const).map((s, i) => (
            <li key={s} aria-current={step === s ? 'step' : undefined} className={`flex-1 rounded-full px-3 py-2 text-center ${step === s ? 'bg-brand text-white' : 'bg-card text-muted'}`}>
              {i + 1}. {t(`coachSpace.assign.step.${s}`)}
            </li>
          ))}
        </ol>

        {step === 'template' && (
          <Card title={t('coachSpace.assign.chooseTemplate')}>
            {templates.isLoading && <p className="text-muted">{t('common.loading')}</p>}
            {templates.data?.length === 0 && (
              <p className="text-muted">{t('coachSpace.templates.empty')} <Link to="/trener/programi/sablon/novi" className="font-semibold underline">{t('coachSpace.templates.new')}</Link></p>
            )}
            <div className="flex flex-col gap-2">
              {templates.data?.map((x) => (
                <label key={x.id} className={`flex cursor-pointer gap-3 rounded-2xl border-2 bg-card p-3 ${templateId === x.id ? 'border-brand' : 'border-line'}`}>
                  <input type="radio" name="template" checked={templateId === x.id} onChange={() => setTemplateId(x.id)} className="mt-1 size-5 accent-brand" />
                  <span>
                    <span className="block font-semibold">{x.name}</span>
                    <span className="block text-xs text-muted">{x.days.map((d) => `${t(`coachSpace.weekdayShort.${d.weekday}`)}: ${d.routine.name}`).join(' · ')}</span>
                  </span>
                </label>
              ))}
            </div>
            <Button className="mt-3 w-full" disabled={!templateId} onClick={() => setStep('clients')}>{t('common.continue')}</Button>
          </Card>
        )}

        {step === 'clients' && (
          <Card title={t('coachSpace.assign.chooseClients')}>
            {template && <p className="mb-3 text-sm text-muted">{template.name}</p>}
            {clients.length === 0 && <p className="text-muted">{t('coach.noClients')}</p>}
            <div className="flex flex-col gap-2">
              {clients.map((c) => (
                <label key={c.client.id} className="flex min-h-12 items-center gap-3 rounded-2xl border border-line bg-card px-3">
                  <input
                    type="checkbox" className="size-5 accent-brand" checked={selected.includes(c.id)}
                    onChange={(e) => setSelected((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))}
                  />
                  <span className="flex-1 font-semibold">{c.client.name}</span>
                  {c.status === 'paused' && <span className="text-xs text-muted">{t('coachSpace.status.paused')}</span>}
                </label>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => setStep('template')}>{t('common.back')}</Button>
              <Button className="flex-1" disabled={!selected.length} onClick={() => setStep('date')}>{t('common.continue')}</Button>
            </div>
          </Card>
        )}

        {step === 'date' && (
          <Card title={t('coachSpace.assign.chooseDate')}>
            <div className="flex flex-col gap-4">
              <Field label={t('coachSpace.assign.startDate')} name="start-date" type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <Field label={`${t('coachSpace.plan.reason')} (${t('common.optional')})`} name="assign-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              <p className="text-sm text-muted">
                {t('coachSpace.assign.summary', { template: template?.name ?? '', count: selected.length })}
              </p>
              <p className="text-xs text-muted">{t('coachSpace.assign.replaceHint')}</p>
              <FormError message={assign.error ? errorMessage(assign.error) : null} />
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setStep('clients')}>{t('common.back')}</Button>
                <Button className="flex-1" disabled={assign.isPending || !startDate || startDate < today} onClick={() => assign.mutate(
                  { templateId, connection_ids: selected, start_date: startDate, reason: reason.trim(), request_id: requestId },
                  { onSuccess: setDone },
                )}>{assign.isPending ? t('common.saving') : t('coachSpace.assign.confirm')}</Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
