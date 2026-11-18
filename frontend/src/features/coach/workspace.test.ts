import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { groupTasks, type CoachTask } from './tasks'
import { taskText } from './taskText'
import {
  foldSearch, initials, inviteLink, isCoachSpacePath, lastSpace, matchesSearch, normalizeInviteCode, qrModules, qrPath,
  readinessReasons, rememberSpace, savePendingInvite, takePendingInvite,
} from './workspace'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

describe('coach workspace', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('tells the coach space from the personal one by route', () => {
    expect(isCoachSpacePath('/trener')).toBe(true)
    expect(isCoachSpacePath('/trener/klijenti/abc')).toBe(true)
    expect(isCoachSpacePath('/trening')).toBe(false)
    expect(isCoachSpacePath('/trenerka')).toBe(false)
  })

  it('remembers the last space per account and defaults to the coach space', () => {
    expect(lastSpace('coach-1')).toBe('coach')
    rememberSpace('coach-1', 'personal')
    expect(lastSpace('coach-1')).toBe('personal')
    expect(lastSpace('coach-2')).toBe('coach')
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(() => rememberSpace('coach-1', 'coach')).not.toThrow()
    expect(lastSpace('coach-1')).toBe('coach')
  })

  it('accepts only real invite codes, from a link or typed in lower case', () => {
    expect(normalizeInviteCode(' abcd1234ef567890 ')).toBe('ABCD1234EF567890')
    expect(normalizeInviteCode('ABCD1234EF56789')).toBeNull()
    expect(normalizeInviteCode('ABCD1234EF56789Z')).toBeNull()
    expect(inviteLink('https://pomak-web.vercel.app/', 'ABCD1234EF567890')).toBe('https://pomak-web.vercel.app/povezi/ABCD1234EF567890')
  })

  it('keeps an invite from a link across login, once', () => {
    savePendingInvite('ABCD1234EF567890')
    expect(takePendingInvite()).toBe('ABCD1234EF567890')
    expect(takePendingInvite()).toBeNull()
  })

  it('searches without caring about case or č/ć/š/ž/đ', () => {
    expect(foldSearch('Đorđe Šćekić')).toBe('djordje scekic')
    expect(matchesSearch('Đorđe Petrović', 'djordje')).toBe(true)
    expect(matchesSearch('Ana Žikić', 'ZIK')).toBe(true)
    expect(matchesSearch('Ana', 'marko')).toBe(false)
    expect(matchesSearch('Ana', '  ')).toBe(true)
    expect(initials('Marko Petrović')).toBe('MP')
    expect(initials('ana')).toBe('AN')
    expect(initials('  ')).toBe('?')
  })

  it('names the answers that pulled readiness down, worst first, and nothing for good answers', () => {
    expect(readinessReasons({ sleep_hours: 4, stress: 4, soreness_lower: 5, motivation: 2 })).toEqual([
      { field: 'sleep_hours', value: 4 },
      { field: 'soreness_lower', value: 5 },
      { field: 'stress', value: 4 },
      { field: 'motivation', value: 2 },
    ])
    expect(readinessReasons({ sleep_hours: 8, stress: 2, motivation: 4, hydration: 3 })).toEqual([])
  })

  it('draws a scannable-size QR code for an invite link', async () => {
    const modules = await qrModules('https://pomak-web.vercel.app/povezi/ABCD1234EF567890')
    expect(modules.length).toBeGreaterThanOrEqual(21)
    expect(modules.every((row) => row.length === modules.length)).toBe(true)
    // The three finder patterns are dark in their corners.
    expect(modules[0][0] && modules[0][modules.length - 1] && modules[modules.length - 1][0]).toBe(true)
    expect(qrPath([[true, false], [false, true]], 0)).toBe('M0 0h1v1h-1zM1 1h1v1h-1z')
  })
})

describe('coach tasks', () => {
  const base = { snoozed_until: null, resolved_at: null, client: { id: 'c1', name: 'Ana' } }
  const task = (patch: Partial<CoachTask>): CoachTask => ({
    id: 'x', kind: 'workout_review', state: 'open', event_at: '2026-11-18T10:00:00Z', data: {}, ...base, ...patch,
  })
  const t = (key: string, options?: Record<string, unknown>) => `${key}${options ? JSON.stringify(options) : ''}`
  const now = new Date('2026-11-18T12:00:00Z')

  it('groups open (newest first), snoozed (soonest back first) and done (latest first)', () => {
    const groups = groupTasks([
      task({ id: 'old', event_at: '2026-11-10T10:00:00Z' }),
      task({ id: 'new' }),
      task({ id: 's2', state: 'snoozed', snoozed_until: '2026-11-25T10:00:00Z' }),
      task({ id: 's1', state: 'snoozed', snoozed_until: '2026-11-19T10:00:00Z' }),
      task({ id: 'd', state: 'done', resolved_at: '2026-11-17T10:00:00Z' }),
    ])
    expect(groups.open.map((x) => x.id)).toEqual(['new', 'old'])
    expect(groups.snoozed.map((x) => x.id)).toEqual(['s1', 's2'])
    expect(groups.done.map((x) => x.id)).toEqual(['d'])
  })

  it('states facts: days without workouts, the readiness answers, the lifts in the app language', () => {
    const inactive = taskText(task({ kind: 'inactive', data: { since: '2026-11-09T12:00:00Z', last_workout_at: '2026-11-09T12:00:00Z' } }), t, false, now)
    expect(inactive.title).toBe('coachSpace.task.inactive{"count":9}')
    const low = taskText(task({ kind: 'low_readiness', data: { score: 31, workout: 'Upper A', answers: { sleep_hours: 5, stress: 5 } } }), t, false, now)
    expect(low.title).toContain('"score":31')
    expect(low.detail).toBe('readiness.sleepValue{"value":5} · readiness.stress 5/5')
    const records = { records: [{ exercise_id: 'e', exercise: 'Bench', exercise_en: 'Bench press', e1rm: '100' }] }
    expect(taskText(task({ kind: 'personal_record', data: records }), t, true, now).title).toContain('Bench press')
    expect(taskText(task({ kind: 'personal_record', data: records }), t, false, now).title).toContain('"lifts":"Bench"')
  })
})
