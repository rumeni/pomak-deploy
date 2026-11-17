import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui'
import i18n from '../../i18n'
import { api, errorMessage } from '../../lib/api'
import { uuid } from '../../lib/uuid'
import type { Routine } from './api'
import { describePrescription, programToRoutines, type Program } from './programs'

function usePrograms() {
  return useQuery({
    queryKey: ['programs', i18n.language],
    queryFn: async () => (await api.get<Program[]>('/training/programs/')).data,
    staleTime: 60 * 60_000,
  })
}

/** Copies all routines of a program into the athlete's own, one by one (each create is retry-safe). */
function useAddProgram() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (program: Program) => {
      for (const body of programToRoutines(program, uuid)) await api.post('/training/routines/', body)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['routines'] }),
  })
}

/**
 * Suggested programs by level (and for women), the profile's match first. Adding one copies its
 * routines into "My routines", where they can be changed like any other.
 */
export function ProgramsSection({ routines }: { routines: Routine[] | undefined }) {
  const { t } = useTranslation()
  const { data, isError } = usePrograms()
  const [showAll, setShowAll] = useState(false)
  if (isError || !data?.length) return null
  const recommended = data.filter((p) => p.recommended)
  const shown = showAll || !recommended.length ? data : recommended

  return (
    <section className="flex flex-col gap-3" aria-labelledby="programs-title">
      <div>
        <h2 id="programs-title" className="text-xl font-extrabold tracking-tight">{t('programs.title')}</h2>
        <p className="text-sm text-muted">{t('programs.intro')}</p>
      </div>
      {shown.map((program) => (
        <ProgramCard key={program.key} program={program} routines={routines} />
      ))}
      {recommended.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="min-h-11 rounded-xl text-sm font-semibold text-brand-dark active:bg-brand-soft"
        >
          {showAll ? t('programs.showRecommended') : t('programs.showAll', { count: data.length })}
        </button>
      )}
    </section>
  )
}

function ProgramCard({ program, routines }: { program: Program; routines: Routine[] | undefined }) {
  const { t } = useTranslation()
  const add = useAddProgram()
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState(false)
  const names = new Set(program.routines.map((r) => r.name))
  const alreadyThere = !!routines?.some((r) => names.has(r.name) && r.notes === program.name)

  const onAdd = () => {
    if (alreadyThere && !window.confirm(t('programs.addAgainConfirm'))) return
    add.mutate(program, { onSuccess: () => setAdded(true) })
  }

  return (
    <article className="app-card flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {program.recommended && <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-white">{t('programs.forYou')}</span>}
        <span className="rounded-full bg-brand-soft px-2 py-0.5 font-semibold">{t(`programs.level_${program.level}`)}</span>
        <span className="rounded-full bg-brand-soft px-2 py-0.5 font-semibold">{t('programs.days', { count: program.days })}</span>
        {program.sex === 'female' && <span className="rounded-full bg-brand-soft px-2 py-0.5 font-semibold">{t('programs.forWomen')}</span>}
      </div>
      <h3 className="text-lg font-bold tracking-tight">{program.name}</h3>
      <p className="text-sm text-muted">{program.description}</p>
      <p className="text-sm">{program.routines.map((r) => r.name).join(' · ')}</p>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-h-11 self-start rounded-xl px-1 text-sm font-semibold text-brand-dark"
      >
        {open ? t('programs.hide') : t('programs.preview')}
      </button>
      {open && (
        <div className="flex flex-col gap-3">
          {program.routines.map((routine) => (
            <div key={routine.name} className="rounded-xl bg-surface p-3">
              <p className="font-semibold">{routine.name}</p>
              <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                {routine.exercises.map((item) => (
                  <li key={item.exercise.id} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{item.exercise.name}</span>
                    <span className="shrink-0 tabular-nums text-muted">{describePrescription(item, 's')}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-muted">{t('programs.rpeHint')}</p>
        </div>
      )}

      {add.isError && <p role="alert" className="text-sm text-danger">{errorMessage(add.error)}</p>}
      {added ? (
        <p role="status" className="rounded-xl bg-brand-soft px-3 py-2 text-sm font-semibold">{t('programs.added', { count: program.routines.length })}</p>
      ) : (
        <Button variant={program.recommended ? 'primary' : 'secondary'} onClick={onAdd} disabled={add.isPending}>
          {add.isPending ? t('common.saving') : t('programs.add', { count: program.routines.length })}
        </Button>
      )}
    </article>
  )
}
