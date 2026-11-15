import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { Exercise } from './api'
import { ExerciseThumb } from './ExerciseImage'
import { ExerciseInfoSheet } from './ExerciseInfoSheet'

/** Sličica vežbe (dodir otvara crtež i podatke o vežbi) + naziv i opcioni red ispod. */
export function ExerciseHeading({ exercise, children }: { exercise: Exercise; children?: ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <ExerciseThumbButton exercise={exercise} onClick={() => setOpen(true)} label={t('exerciseInfo.open', { name: exercise.name })} />
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-brand-dark">{exercise.name}</h2>
        {children}
      </div>
      {open && <ExerciseInfoSheet exercise={exercise} onClose={() => setOpen(false)} />}
    </div>
  )
}

export function ExerciseThumbButton({ exercise, onClick, label }: { exercise: Exercise; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="shrink-0 rounded-xl active:opacity-70">
      <ExerciseThumb exercise={exercise} />
    </button>
  )
}
