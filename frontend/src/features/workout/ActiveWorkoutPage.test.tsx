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
vi.mock('../training/ExerciseHeading', () => ({ ExerciseHeading: () => null }))

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
