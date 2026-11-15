import { useTranslation } from 'react-i18next'

import { EmptyState, PageHeader } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { LanguageMenu } from '../../components/LanguageMenu'

export function CoachPage() {
  const { me } = useAuth()
  const { t } = useTranslation()

  return (
    <>
      <PageHeader title={t('coach.title')} action={<LanguageMenu />} />
      <div className="flex flex-col gap-3 px-4">
        {me?.profile.is_coach ? (
          <EmptyState title={t('coach.coachSpace')} text={t('coach.coachSpaceText')} />
        ) : (
          <EmptyState title={t('coach.solo')} text={t('coach.soloText')} />
        )}
      </div>
    </>
  )
}
