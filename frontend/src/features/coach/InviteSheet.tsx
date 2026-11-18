import { Capacitor } from '@capacitor/core'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { BottomSheet } from '../../components/BottomSheet'
import { Button, Field, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { getFormatLocale } from '../../lib/format'
import { useCreateCoachInvite, useRevokeCoachInvite, type CoachInvitation } from './api'
import { inviteLink, qrModules, qrPath } from './workspace'

/** The public web app: the Android app runs on https://localhost, which a client cannot open. */
function webOrigin(): string {
  if (!Capacitor.isNativePlatform()) return window.location.origin
  return (import.meta.env.VITE_WEB_URL as string | undefined) ?? 'https://pomak-web.vercel.app'
}

/** New invitation (optionally "for whom"), then its code, link and QR to show or send. */
export function InviteSheet({ invitations, onClose }: { invitations: CoachInvitation[]; onClose: () => void }) {
  const { t } = useTranslation()
  const create = useCreateCoachInvite()
  const [label, setLabel] = useState('')
  const [shownId, setShownId] = useState<string | null>(null)
  const shown = invitations.find((i) => i.id === shownId) ?? (create.data && create.data.id === shownId ? create.data : null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate(label.trim(), { onSuccess: (invite) => { setShownId(invite.id); setLabel('') } })
  }

  return (
    <BottomSheet label={t('coachSpace.invite.title')} title={t('coachSpace.invite.title')} onClose={onClose}>
      {shown ? (
        <InviteDetails invite={shown} onBack={() => setShownId(null)} />
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          <p className="text-sm text-muted">{t('coachSpace.invite.explanation')}</p>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <Field
              label={`${t('coachSpace.invite.label')} (${t('common.optional')})`}
              name="invite-label"
              value={label}
              maxLength={60}
              autoComplete="off"
              placeholder={t('coachSpace.invite.labelPlaceholder')}
              onChange={(e) => setLabel(e.target.value)}
            />
            <FormError message={create.error ? errorMessage(create.error) : null} />
            <Button disabled={create.isPending || invitations.length >= 5}>{t('coachSpace.invite.create')}</Button>
            {invitations.length >= 5 && <p className="text-sm text-muted">{t('coachSpace.invite.limit')}</p>}
          </form>
          {invitations.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold">{t('coachSpace.invite.pending')}</p>
              <ul className="flex flex-col gap-2">
                {invitations.map((invite) => (
                  <li key={invite.id}>
                    <button type="button" onClick={() => setShownId(invite.id)} className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-line bg-card px-4 text-left">
                      <span>
                        <span className="block font-semibold">{invite.label || t('coachSpace.invite.unnamed')}</span>
                        <span className="block text-xs text-muted">{t('coach.expires', { date: shortDate(invite.expires_at) })}</span>
                      </span>
                      <span className="text-sm text-muted">{t('coachSpace.invite.show')} ›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  )
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short' })
}

function InviteDetails({ invite, onBack }: { invite: CoachInvitation; onBack: () => void }) {
  const { t } = useTranslation()
  const revoke = useRevokeCoachInvite()
  const link = inviteLink(webOrigin(), invite.code)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  const copy = (what: 'code' | 'link') => {
    void navigator.clipboard?.writeText(what === 'code' ? invite.code : link).then(() => setCopied(what), () => setCopied(null))
  }
  const share = () => {
    void navigator.share?.({ title: 'POMAK', text: t('coachSpace.invite.shareText'), url: link }).catch(() => undefined)
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-3 text-center">
      {invite.label && <p className="font-semibold">{invite.label}</p>}
      <QrCode text={link} />
      <p className="text-sm text-muted">{t('coachSpace.invite.scanHint')}</p>
      <code className="select-all rounded-xl bg-card px-3 py-2 text-lg font-semibold tracking-widest">{invite.code}</code>
      <p className="text-xs text-muted">{t('coach.expires', { date: shortDate(invite.expires_at) })}</p>
      <div className="grid w-full grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => copy('link')}>{copied === 'link' ? t('coachSpace.invite.copied') : t('coachSpace.invite.copyLink')}</Button>
        <Button variant="secondary" onClick={() => copy('code')}>{copied === 'code' ? t('coachSpace.invite.copied') : t('coachSpace.invite.copyCode')}</Button>
      </div>
      {'share' in navigator && <Button className="w-full" onClick={share}>{t('coachSpace.invite.share')}</Button>}
      <FormError message={revoke.error ? errorMessage(revoke.error) : null} />
      <div className="flex w-full justify-between">
        <Button variant="ghost" onClick={onBack}>‹ {t('common.back')}</Button>
        <Button variant="ghost" className="text-danger" disabled={revoke.isPending} onClick={() => revoke.mutate(invite.id, { onSuccess: onBack })}>
          {t('coach.revoke')}
        </Button>
      </div>
    </div>
  )
}

/** QR code drawn as one SVG path; works offline, no image service involved. */
export function QrCode({ text }: { text: string }) {
  const { t } = useTranslation()
  const [modules, setModules] = useState<boolean[][] | null>(null)
  useEffect(() => {
    let alive = true
    void qrModules(text).then((m) => { if (alive) setModules(m) }, () => { if (alive) setModules([]) })
    return () => { alive = false }
  }, [text])
  if (!modules) return <div className="size-52 animate-pulse rounded-2xl bg-card" aria-hidden />
  if (!modules.length) return null
  const size = modules.length + 4
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="size-52 rounded-2xl bg-white" role="img" aria-label={t('coachSpace.invite.qrAria')} shapeRendering="crispEdges">
      <path d={qrPath(modules)} fill="#000" />
    </svg>
  )
}
