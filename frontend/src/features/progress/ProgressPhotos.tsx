import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, Field, FormError, selectClass } from '../../components/ui'
import { errorMessage } from '../../lib/api'
import { formatShortDate, toISODate } from '../../lib/format'
import { uuid } from '../../lib/uuid'
import { PictureError, shrinkPicture, usePictureUrl } from '../coach/pictures'
import {
  POSES, comparePair, imagePath, toggleSelected, useDeletePhoto, useProgressPhotos, useUploadPhoto,
  type PhotoSource, type Pose, type ProgressPhoto,
} from './photos'

/**
 * Progress photos: a grid by day, and two of them side by side (before -> after). The athlete
 * adds and deletes his own; a coach sees a client's only while measurements are shared.
 * `weightOn` gives the body weight measured that day, shown under a compared photo.
 */
export function ProgressPhotos({ source, weightOn }: { source: PhotoSource; weightOn?: (date: string) => string | null }) {
  const { t } = useTranslation()
  const own = source.kind === 'own'
  const photos = useProgressPhotos(source)
  const remove = useDeletePhoto()
  const [selected, setSelected] = useState<string[]>([])
  const list = photos.data ?? []
  const pair = comparePair(list, selected)
  const single = selected.length === 1 ? list.find((p) => p.id === selected[0]) ?? null : null

  if (!own && photos.data === null) {
    return <Card title={t('photos.title')}><p className="text-muted">{t('coach.notShared')}</p></Card>
  }

  return (
    <Card title={t('photos.title')}>
      {own && <AddPhoto />}
      {photos.isLoading && <p className="text-muted">{t('common.loading')}</p>}
      {photos.isError && <p className="text-danger">{t('photos.loadFailed')}</p>}
      {photos.data?.length === 0 && <p className="text-sm text-muted">{own ? t('photos.emptyOwn') : t('photos.empty')}</p>}

      {pair && (
        <div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label={t('photos.compare')}>
          {pair.map((photo) => (
            <figure key={photo.id} className="flex flex-col gap-1">
              <PhotoImage source={source} photo={photo} large />
              <figcaption className="text-center text-xs">
                <span className="font-semibold">{formatShortDate(photo.taken_on)}</span>
                {weightOn?.(photo.taken_on) && <span className="text-muted"> · {weightOn(photo.taken_on)}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {list.length > 1 && (
        <p className="mb-2 text-xs text-muted">{pair ? t('photos.compareHint') : t('photos.pickTwo')}</p>
      )}

      {list.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {list.map((photo) => {
            const isSelected = selected.includes(photo.id)
            return (
              <li key={photo.id}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={t('photos.pick', { date: formatShortDate(photo.taken_on), pose: t(`photos.pose_${photo.pose}`) })}
                  onClick={() => setSelected((s) => toggleSelected(s, photo.id))}
                  className={`block w-full overflow-hidden rounded-xl ring-2 ${isSelected ? 'ring-brand' : 'ring-transparent'}`}
                >
                  <PhotoImage source={source} photo={photo} />
                  <span className="block truncate bg-surface px-1 py-0.5 text-center text-[11px]">
                    {formatShortDate(photo.taken_on)} · {t(`photos.pose_${photo.pose}`)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {single?.note && <p className="mt-2 text-sm">„{single.note}“</p>}
      {own && single && (
        <Button
          variant="ghost"
          className="mt-2 text-danger"
          disabled={remove.isPending}
          onClick={() => {
            if (!window.confirm(t('photos.deleteConfirm', { date: formatShortDate(single.taken_on) }))) return
            remove.mutate(single.id, { onSuccess: () => setSelected([]) })
          }}
        >
          {t('photos.delete')}
        </Button>
      )}
      <FormError message={remove.isError ? errorMessage(remove.error) : null} />
    </Card>
  )
}

function PhotoImage({ source, photo, large = false }: { source: PhotoSource; photo: ProgressPhoto; large?: boolean }) {
  const { t } = useTranslation()
  const { url, failed } = usePictureUrl(imagePath(source, photo.id))
  return (
    <span className={`flex items-center justify-center overflow-hidden rounded-lg bg-surface ${large ? 'aspect-[3/4]' : 'aspect-square'}`}>
      {url ? (
        <img src={url} alt={t('photos.alt', { date: formatShortDate(photo.taken_on) })} className="size-full object-cover" />
      ) : (
        <span className="text-xs text-muted">{failed ? t('coach.pictures.unavailable') : '…'}</span>
      )}
    </span>
  )
}

/** Choose a picture, then its day and pose; the same ID on a retry, so it is stored once. */
function AddPhoto() {
  const { t } = useTranslation()
  const upload = useUploadPhoto()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [date, setDate] = useState(toISODate(new Date()))
  const [pose, setPose] = useState<Pose>('front')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const id = useRef(uuid())

  const reset = () => {
    setFile(null)
    setNote('')
    setError(null)
    upload.reset()
    id.current = uuid()
    if (input.current) input.current.value = ''
  }

  const onSave = async () => {
    if (!file) return
    setError(null)
    try {
      const picture = await shrinkPicture(file, 1280)
      upload.mutate({ id: id.current, picture, taken_on: date, pose, note: note.trim() }, { onSuccess: reset })
    } catch (e) {
      if (e instanceof PictureError) setError(t(e.message))
      else throw e
    }
  }

  return (
    <div className="mb-3">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={t('photos.choose')}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {!file ? (
        <Button variant="secondary" className="w-full" onClick={() => input.current?.click()}>{t('photos.add')}</Button>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl bg-surface p-3">
          <p className="truncate text-sm font-semibold">{file.name}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('progress.date')} name="taken_on" type="date" max={toISODate(new Date())} value={date} onChange={(e) => setDate(e.target.value)} />
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('photos.pose')}
              <select value={pose} onChange={(e) => setPose(e.target.value as Pose)} className={selectClass}>
                {POSES.map((p) => <option key={p} value={p}>{t(`photos.pose_${p}`)}</option>)}
              </select>
            </label>
          </div>
          <Field label={t('photos.note')} name="note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          <FormError message={error ?? (upload.isError ? errorMessage(upload.error) : null)} />
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => void onSave()} disabled={upload.isPending}>
              {upload.isPending ? t('common.saving') : t('common.save')}
            </Button>
            <Button variant="secondary" onClick={reset} disabled={upload.isPending}>{t('photos.cancel')}</Button>
          </div>
          <p className="text-xs text-muted">{t('photos.privacy')}</p>
        </div>
      )}
    </div>
  )
}
