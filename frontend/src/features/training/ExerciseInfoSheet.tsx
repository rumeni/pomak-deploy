import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import type { Exercise } from './api'
import { ExerciseDemo, exerciseImageUrls } from './ExerciseImage'
import { ExerciseInstructions } from './ExerciseInstructions'

/** Donji panel sa crtežom vežbe, osnovnim podacima (mišić, oprema) i uputstvom. Zatvara se dodirom van panela ili ✕. */
export function ExerciseInfoSheet({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    // Dok je panel otvoren, lista iza njega se ne pomera.
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  const chips = [t(`muscle.${exercise.muscle}`), t(`equipment.${exercise.equipment}`), t(`measurement.${exercise.measurement}`)]
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose} role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={exercise.name}
        onClick={(e) => e.stopPropagation()}
        className="pb-safe max-h-[90vh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-3xl bg-surface p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{exercise.name}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-line">
            ✕
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-brand-soft px-3 py-1 text-sm text-brand-dark">
              {c}
            </span>
          ))}
        </div>
        <div className="mt-3">
          {exerciseImageUrls(exercise) ? <ExerciseDemo exercise={exercise} /> : <p className="text-sm text-muted">{t('exerciseInfo.noImage')}</p>}
        </div>
        {exercise.instructions && (
          <section className="mt-4">
            <h3 className="mb-2 font-semibold">{t('exerciseInfo.howTo')}</h3>
            <ExerciseInstructions text={exercise.instructions} />
          </section>
        )}
      </section>
    </div>
  )
}
