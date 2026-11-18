import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/** Prevent accidental loss of an unfinished web edit on reload or explicit Back.
 * A successful save navigates normally; only abandoning the edit asks for consent.
 */
export function useUnsavedWarning(dirty: boolean): (leave: () => void) => void {
  const { t } = useTranslation()
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  return (leave) => {
    if (!dirty || window.confirm(t('common.leaveUnsaved'))) leave()
  }
}
