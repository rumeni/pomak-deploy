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
import { describePrescription, firstImportRoutines, importProgram, isImportingProgram, loadPendingProgram, programAlreadyAdded, programToRoutines, withProgramImportLock, type PendingProgram, type Program } from './programs'
import { setProgramsHidden, useProgramsHidden } from './programsPref'

function usePrograms(enabled: boolean) {
  return useQuery({
    queryKey: ['programs', i18n.language],
    queryFn: async () => (await api.get<Program[]>('/training/programs/')).data,
    staleTime: 60 * 60_000,
    enabled,
  })
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
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
 *
 * With routines of one's own the section starts collapsed to one row; it can also be hidden
 * (per account on this device) and brought back here right away or later in Profil.
 */
export function ProgramsSection({ routines }: { routines: Routine[] | undefined }) {
  const { t } = useTranslation()
  const { me } = useAuth()
  const hidden = useProgramsHidden(me?.id)
  const { data, isError } = usePrograms(!hidden)
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState<boolean | null>(null)
  // Hidden in this visit: a short note with undo, instead of the section vanishing silently.
  const [justHidden, setJustHidden] = useState(false)

  if (hidden) {
    if (!justHidden || !me) return null
    return (
      <p role="status" className="flex items-center justify-between gap-3 rounded-2xl bg-brand-soft px-4 py-2 text-sm">
        <span>{t('programs.hiddenNotice')}</span>
        <button
          type="button"
          onClick={() => { setProgramsHidden(me.id, false); setJustHidden(false) }}
          className="min-h-11 shrink-0 rounded-xl px-2 font-semibold underline"
        >
          {t('programs.undo')}
        </button>
      </p>
    )
  }
  if (isError || !data?.length) return null
  const recommended = data.filter((p) => p.recommended)
  const shown = showAll || !recommended.length ? data : recommended
  const collapsible = !!routines?.length
  const open = !collapsible || (expanded ?? false)

  const hide = () => {
    if (!me) return
    setJustHidden(true)
    setProgramsHidden(me.id, true)
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="programs-title">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 id="programs-title" className="text-xl font-extrabold tracking-tight">
            {collapsible ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls="programs-list"
                onClick={() => setExpanded(!open)}
                className="min-h-11 text-left"
              >
                {t('programs.title')}
                <span className="ml-1.5 inline-block align-middle">
                  <Chevron open={open} />
                </span>
              </button>
            ) : (
              t('programs.title')
            )}
          </h2>
          <p className="text-sm text-muted">{open ? t('programs.intro') : t('programs.collapsedIntro', { count: data.length })}</p>
        </div>
        <button
          type="button"
          onClick={hide}
          className="min-h-11 shrink-0 rounded-xl px-2 text-sm font-semibold text-muted active:bg-brand-soft"
        >
          {t('programs.hideSection')}
        </button>
      </div>
      {open && (
        <div id="programs-list" className="flex flex-col gap-3">
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
        </div>
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
  const busy = useRef(false)
  const [waiting, setWaiting] = useState(false)
  // The batch (with its routine IDs) of an add that has not finished: a retry resumes it.
  const pending = useRef<{ ownerId: string; record: PendingProgram } | null>(null)
  // Existing routines are re-fetched under the cross-tab lock before import; here they only mark
  // a program that is already in "My routines".
  const inRoutines = programAlreadyAdded(program, routines)
  const routineNames = program.routines.map((r) => r.name).join(' · ')

  const onAdd = async () => {
    if (!me || busy.current) return
    busy.current = true
    setWaiting(true)
    const scope: AuthScope = { ownerId: me.id, session: tokens.session() }
    try {
      await withProgramImportLock(me.id, program.key, async () => {
        if (!scopeIsCurrent(scope)) return
        // The second tab must re-check the server inside the lock, not rely on
        // stale React-query state captured before the first tab imported.
        const previous = loadPendingProgram(me.id, program)
          ?? (pending.current?.ownerId === me.id ? pending.current.record : null)
        if (previous || isImportingProgram(me.id, program.key)) {
          pending.current = { ownerId: me.id, record: previous ?? pending.current?.record ?? { batch: [], done: [] } }
        } else {
          const fresh = (await api.get<Routine[]>('/training/routines/')).data
          const standard = await firstImportRoutines(program, me.id)
          const present = new Set(fresh.map((routine) => routine.id))
          const seenSome = standard.some((routine) => present.has(routine.id!))
          const seenAll = standard.every((routine) => present.has(routine.id!))
          // A second device must RESUME a partially committed first import.
          // Ask for a deliberate second copy only once the first batch is done.
          const alreadyThere = programAlreadyAdded(program, fresh)
          const needsConfirm = alreadyThere && (!seenSome || seenAll)
          if (needsConfirm && !window.confirm(t('programs.addAgainConfirm'))) return
          const batch = needsConfirm ? programToRoutines(program, uuid) : standard
          if (!scopeIsCurrent(scope)) return
          pending.current = { ownerId: me.id, record: { batch, done: [] } }
        }
        await add.mutateAsync({ scope, programKey: program.key, record: pending.current.record })
        pending.current = null
        setAdded(true)
      })
    } catch {
      // React Query's mutation error is displayed below the preview.
    } finally {
      busy.current = false
      setWaiting(false)
    }
  }

  // Just added: one compact row instead of the whole card.
  if (added) {
    return (
      <article role="status" className="app-card flex items-center gap-3">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-white">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 5 5 9-10" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{program.name}</span>
          <span className="block text-sm text-muted">{t('programs.added', { count: program.routines.length })}</span>
        </span>
      </article>
    )
  }

  return (
    <article className="app-card flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {program.recommended && <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-white">{t('programs.forYou')}</span>}
        <span className="rounded-full bg-brand-soft px-2 py-0.5 font-semibold">{t(`programs.level_${program.level}`)}</span>
        <span className="rounded-full bg-brand-soft px-2 py-0.5 font-semibold">{t('programs.days', { count: program.days })}</span>
        {program.sex === 'female' && <span className="rounded-full bg-brand-soft px-2 py-0.5 font-semibold">{t('programs.forWomen')}</span>}
        {inRoutines && <span className="rounded-full bg-ink px-2 py-0.5 font-semibold text-white">{t('programs.inYourRoutines')}</span>}
      </div>
      <h3 className="text-lg font-bold tracking-tight">{program.name}</h3>
      <p className="text-sm text-muted">{program.description}</p>
      {/* The routine list only when it says more than the name (many names are the list itself). */}
      {routineNames !== program.name && <p className="text-sm">{routineNames}</p>}

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-full px-4 text-sm font-semibold ring-1 ring-line active:bg-brand-soft"
      >
        {open ? t('programs.hide') : t('programs.preview')}
        <Chevron open={open} />
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
      <Button variant={program.recommended && !inRoutines ? 'primary' : 'secondary'} onClick={() => void onAdd()} disabled={add.isPending || waiting}>
        {add.isPending ? t('common.saving') : add.isError ? t('programs.retry') : t('programs.add', { count: program.routines.length })}
      </Button>
    </article>
  )
}
