import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { exerciseImageUrls, type WithSlug } from './exerciseImageUrls'

/** Mala sličica vežbe; bez crteža ujednačena ikonica (kardio ili snaga). */
export function ExerciseThumb({ exercise, size = 'md' }: { exercise: WithSlug; size?: 'sm' | 'md' }) {
  const urls = exerciseImageUrls(exercise)
  const box = size === 'sm' ? 'size-11' : 'size-14'
  return (
    <span className={`${box} flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-line`} aria-hidden>
      {urls ? (
        <img src={urls[0]} alt="" loading="lazy" className="size-full object-contain p-0.5" />
      ) : (
        <FallbackIcon cardio={exercise.muscle === 'cardio'} />
      )}
    </span>
  )
}

function FallbackIcon({ cardio }: { cardio: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6 text-brand" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {cardio ? (
        <path d="M3 12h4l2-5 4 10 2-5h6" />
      ) : (
        <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
      )}
    </svg>
  )
}

/**
 * Crtež vežbe: početni i završni položaj se smenjuju (kao kratka animacija). Ko ne želi animacije
 * (podešavanje telefona) vidi oba položaja jedan pored drugog.
 */
export function ExerciseDemo({ exercise, compact = false }: { exercise: WithSlug; compact?: boolean }) {
  const { t } = useTranslation()
  const urls = exerciseImageUrls(exercise)
  const [frame, setFrame] = useState(0)
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)

  const hasImage = urls !== null
  useEffect(() => {
    if (!hasImage || reduced) return
    const id = setInterval(() => setFrame((f) => 1 - f), 1100)
    return () => clearInterval(id)
  }, [hasImage, reduced])

  if (!urls) return null
  return (
    <figure className="flex flex-col gap-1">
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-line/60">
        {reduced ? (
          <div className="grid grid-cols-2">
            {urls.map((u) => (
              <img key={u} src={u} alt="" className="aspect-square w-full object-contain p-2" />
            ))}
          </div>
        ) : (
          <div className={`relative mx-auto aspect-square w-full ${compact ? 'max-w-44' : 'max-w-72'}`}>
            {urls.map((u, i) => (
              <img
                key={u}
                src={u}
                alt={i === 0 ? t('exerciseInfo.startPosition', { name: exercise.name }) : t('exerciseInfo.endPosition', { name: exercise.name })}
                className={`absolute inset-0 size-full object-contain p-2 transition-opacity duration-300 ${frame === i ? 'opacity-100' : 'opacity-0'}`}
              />
            ))}
          </div>
        )}
      </div>
      <figcaption className="text-xs text-muted">
        {t('exerciseInfo.credit')}{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" className="underline">
          CC BY-SA 4.0
        </a>
      </figcaption>
    </figure>
  )
}
