import { usePictureUrl } from './pictures'
import { initials } from './workspace'

/** A picture in a circle when there is one (`photo`: its API path), otherwise initials. */
export function Avatar({ name, muted = false, size = 'md', photo = null }: {
  name: string
  muted?: boolean
  size?: 'md' | 'lg'
  photo?: string | null
}) {
  const { url } = usePictureUrl(photo)
  const box = size === 'lg' ? 'size-14 text-lg' : 'size-11 text-sm'
  if (url) return <img src={url} alt="" aria-hidden className={`${box} shrink-0 rounded-full object-cover`} />
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${box} ${muted ? 'bg-line text-muted' : 'bg-brand-soft text-brand-dark'}`}
    >
      {initials(name)}
    </span>
  )
}
