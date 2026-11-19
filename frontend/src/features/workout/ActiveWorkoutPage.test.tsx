import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActiveWorkout } from './model'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('./restNotification', () => ({
  cancelRestEnd: vi.fn(), restEndedFeedback: vi.fn(), scheduleRestEnd: vi.fn(),
  restNotificationAction: () => ({ cancel: false, schedule: null }),
}))
vi.mock('./previous', () => ({ loadPrevious: vi.fn() }))
vi.mock('../../i18n', () => ({ default: { language: 'sr-Latn' } }))
vi.mock('../training/ExercisePicker', () => ({ ExercisePicker: () => null }))
vi.mock('../training/ExerciseHeading', () => ({ ExerciseHeading: ({ children }: { children?: unknown }) => children ?? null }))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ me: null }) }))
vi.mock('../coach/inboxApi', () => ({ useMyInstructions: () => ({ data: undefined }) }))
vi.mock('@tanstack/react-query', async (original) => ({ ...(await original<object>()), useQueryClient: () => ({ getQueryData: () => undefined }) }))

const store = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('./store', () => ({ usePersistentWorkout: () => store.value }))

import { ActiveWorkoutPage } from './ActiveWorkoutPage'

const workout: ActiveWorkout = {
  id: 'w1', routineId: null, name: 'Snaga A', startedAt: '2026-11-17T10:00:00Z',
  planSnapshot: null, previous: {}, rest: null, exercises: [],
}

function render(conflict: boolean) {
  store.value = {
    loaded: true, conflict, update: vi.fn(), flush: vi.fn(),
    row: { slot: 'u1', ownerId: 'u1', workout: { ...workout, readiness: { ...EMPTY, motivation: 4 } } },
  }
  return renderToStaticMarkup(<MemoryRouter><ActiveWorkoutPage /></MemoryRouter>)
}

const EMPTY = { sleep_hours: null, hydration: null, stress: null, motivation: null, soreness_upper: null, soreness_lower: null }

describe('readiness step and persistence conflicts', () => {
  beforeEach(() => { store.value = null })

  it('opens the check-in first while the workout is saved normally', () => {
    const html = render(false)
    expect(html).toContain('readiness.title')
    expect(html).not.toContain('workout.concurrentEdit')
    expect(html).not.toContain('disabled=""')
  })

  it('shows the reload alert and locks the step when saving stops working', () => {
    const html = render(true)
    expect(html).toContain('role="alert"')
    expect(html).toContain('workout.concurrentEdit')
    // Skip, Start and every answer are disabled: nothing more could be saved.
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0])
    const locked = buttons.filter((b) => b.includes('disabled=""'))
    expect(locked.length).toBe(7 + 5 * 5 + 2)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>readiness\.start</)
  })
})

describe('marking sets as done', () => {
  const bench = {
    id: 'bench', name: 'Bench', aliases: '', equipment: 'barbell', measurement: 'weight_reps',
    load_mode: 'total', muscle: 'chest', instructions: '', is_custom: false,
  } as const
  const set = (patch: Record<string, unknown>) => ({
    key: Math.random().toString(36), set_type: 'working', weight: '', reps: '', duration: '', distance: '',
    rpe: null, target: null, done: false, completedAt: null, ...patch,
  })

  function renderSets() {
    store.value = {
      loaded: true, conflict: false, update: vi.fn(), flush: vi.fn(),
      row: {
        slot: 'u1', ownerId: 'u1',
        workout: {
          ...workout, checkInDone: true,
          exercises: [{
            key: 'e1', exercise: bench, notes: '', rest_seconds: 90,
            sets: [
              set({ set_type: 'warmup', weight: '40', reps: '10', done: true, completedAt: '2026-11-17T10:05:00Z' }),
              set({ weight: '60', reps: '8' }),
              set({}),
            ],
          }],
        },
      },
    }
    return renderToStaticMarkup(<MemoryRouter><ActiveWorkoutPage /></MemoryRouter>)
  }

  it('shows an empty box for a set not done and a filled one with a check when done', () => {
    const html = renderSets()
    expect(html).toContain('workout.colDone')
    expect((html.match(/data-confirmed="true"/g) ?? []).length).toBe(1)
    expect((html.match(/data-confirmed="false"/g) ?? []).length).toBe(2)
    // The check mark is drawn only inside the confirmed box.
    const boxes = [...html.matchAll(/<span data-confirmed="(true|false)"[^>]*>(.*?)<\/span>/g)]
    expect(boxes.map(([, state, inner]) => [state, inner.includes('<svg')])).toEqual([['true', true], ['false', false], ['false', false]])
  })

  it('counts done sets, warm-ups included, and explains confirming the first time', () => {
    const html = renderSets()
    expect((html.match(/workout\.setsProgress/g) ?? []).length).toBe(2) // the workout and the exercise
    expect(html).toContain('workout.confirmHintTitle')
  })
})
