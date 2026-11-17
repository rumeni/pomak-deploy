import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../components/ui'
import i18n from '../../i18n'
import axios from 'axios'

import { api, errorMessage, scopeIsCurrent, type AuthScope, type ScopedRequestConfig } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { uuid } from '../../lib/uuid'
import { useAuth } from '../../lib/auth'
import type { Routine, RoutinePayload } from './api'
import { describePrescription, importProgram, isImportingProgram, loadPendingProgram, programToRoutines, type PendingProgram, type Program } from './programs'

function usePrograms() {
  return useQuery({
    queryKey: ['programs', i18n.language],
    queryFn: async () => (await api.get<Program[]>('/training/programs/')).data,
    staleTime: 60 * 60_000,
  })
}

/**
 * Imports a program for the account and login session that started it (AuthScope): every
 * request carries the scope, so a logout or account switch stops the import. Runs to the end
 * (and clears its record) even if the screen is left meanwhile.
 */
function useAddProgram() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ scope, programKey, record }: { scope: AuthScope; programKey: string; record: PendingProgram }) => {
      const config: ScopedRequestConfig = { __pomakScope: scope }
      return importProgram(scope.ownerId, programKey, record, {
        isCurrent: () => scopeIsCurrent(scope),
        // Create-only on the server: an existing routine (e.g. made by this import in another
        // tab and edited since) answers 412 and stays untouched.
        create: async (body: RoutinePayload) => {
          try {
            await api.post('/training/routines/?create_only=1', body, config)
            return 'created'
          } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 412) return 'exists'
            throw error
          }
        },
      })
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
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState(false)
  // The batch (with its routine IDs) of an add that has not finished: a retry resumes it.
  const pending = useRef<{ ownerId: string; record: PendingProgram } | null>(null)
  const names = new Set(program.routines.map((r) => r.name))
  const alreadyThere = !!routines?.some((r) => names.has(r.name) && r.notes === program.name)

  const onAdd = () => {
    if (!me) return
    // A persisted batch takes precedence even when this component was unmounted or reloaded.
    // An import of this program already running (started before leaving the screen) is joined,
    // never started twice. Otherwise the stored record wins over this screen's memory.
    const previous = loadPendingProgram(me.id, program)
      ?? (pending.current?.ownerId === me.id ? pending.current.record : null)
    if (previous || isImportingProgram(me.id, program.key)) {
      pending.current = { ownerId: me.id, record: previous ?? pending.current?.record ?? { batch: [], done: [] } }
    } else {
      if (alreadyThere && !window.confirm(t('programs.addAgainConfirm'))) return
      pending.current = { ownerId: me.id, record: { batch: programToRoutines(program, uuid), done: [] } }
    }
    const scope: AuthScope = { ownerId: me.id, session: tokens.session() }
    add.mutate({ scope, programKey: program.key, record: pending.current.record }, {
      onSuccess: () => {
        pending.current = null
        setAdded(true)
      },
    })
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
          {add.isPending ? t('common.saving') : add.isError ? t('programs.retry') : t('programs.add', { count: program.routines.length })}
        </Button>
      )}
    </article>
  )
}
