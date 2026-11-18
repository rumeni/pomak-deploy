import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePictureUrl } from './pictures'

/** A picture from a conversation: a thumbnail that opens full screen. */
export function MessagePicture({ imageId }: { imageId: string }) {
  const { t } = useTranslation()
  const { url, failed } = usePictureUrl(`/coach/images/${imageId}/`)
  const [open, setOpen] = useState(false)
  if (failed) return <p className="text-xs text-muted">{t('coach.pictures.unavailable')}</p>
  if (!url) return <div className="h-40 w-56 max-w-full animate-pulse rounded-lg bg-line" aria-label={t('common.loading')} />
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block" aria-label={t('coach.pictures.open')}>
        <img src={url} alt={t('coach.pictures.alt')} className="max-h-64 max-w-full rounded-lg object-contain" />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={t('coach.pictures.alt')}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setOpen(false)}>
          <img src={url} alt={t('coach.pictures.alt')} className="max-h-full max-w-full object-contain" />
          <button type="button" className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex size-11 items-center justify-center rounded-full bg-white/15 text-xl text-white"
            aria-label={t('common.close')} onClick={() => setOpen(false)}>✕</button>
        </div>
      )}
    </>
  )
}
