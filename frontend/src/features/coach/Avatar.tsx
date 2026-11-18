import { initials } from './workspace'

/** Initials in a circle (no photos yet: those come with file storage). */
export function Avatar({ name, muted = false, size = 'md' }: { name: string; muted?: boolean; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${size === 'lg' ? 'size-14 text-lg' : 'size-11 text-sm'} ${muted ? 'bg-line text-muted' : 'bg-brand-soft text-brand-dark'}`}
    >
      {initials(name)}
    </span>
  )
}
