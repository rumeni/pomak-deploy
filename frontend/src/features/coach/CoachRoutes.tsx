import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { Button, Card } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { useCoachDashboard } from './api'
import { CoachHomePage } from './CoachHomePage'
import { CoachPage } from './CoachPage'
import { normalizeInviteCode, savePendingInvite } from './workspace'

/** /trener: the coach space's overview for a coach, the Coach tab for everyone else. */
export function CoachRoot() {
  const { me } = useAuth()
  return me?.profile.is_coach ? <CoachOnly><CoachHomePage /></CoachOnly> : <CoachPage />
}

/**
 * Coach-space screens. A coach who has not answered the starting questions is taken there first
 * (unless offline with nothing loaded: then the screens still open with what is cached).
 */
export function CoachOnly({ children }: { children: ReactNode }) {
  const { me } = useAuth()
  const isCoach = !!me?.profile.is_coach
  const dashboard = useCoachDashboard()
  if (!isCoach) return <Navigate to="/trener" replace />
  if (dashboard.data?.role === 'coach' && dashboard.data.profile_completed === false) return <Navigate to="/trener/pocetak" replace />
  return <>{children}</>
}

/** An invite link (/povezi/CODE) opened while logged in. */
export function InviteLinkPage() {
  const { t } = useTranslation()
  const { code: raw } = useParams()
  const { me } = useAuth()
  const navigate = useNavigate()
  const code = normalizeInviteCode(raw ?? '')
  if (me?.profile.is_coach) {
    return (
      <div className="p-4">
        <Card>
          <p>{t('coachSpace.connect.coachOpenedInvite')}</p>
          <Button className="mt-3" onClick={() => navigate('/trener', { replace: true })}>{t('coachSpace.tabs.overview')}</Button>
        </Card>
      </div>
    )
  }
  return <Navigate to={code ? `/trener?kod=${code}` : '/trener'} replace />
}

/** An invite link opened before logging in: keep the code, then log in (or sign up). */
export function InviteLinkLoggedOut() {
  const { code } = useParams()
  const valid = normalizeInviteCode(code ?? '')
  if (valid) savePendingInvite(valid)
  return <Navigate to="/prijava" replace />
}
