import { describe, expect, it } from 'vitest'

import type { OutboxRow } from '../../lib/db'
import type { Exercise } from '../training/api'
import { combineHistory, formatWorkoutDuration, fromOutbox, setCount, type SessionView } from './history'

const bench: Exercise = {
  id: 'bench', name: 'Bench', aliases: '', equipment: 'barbell', measurement: 'weight_reps',
  load_mode: 'total', muscle: 'chest', instructions: '', is_custom: false,
}
const squat: Exercise = { ...bench, id: 'squat', name: 'Squat' }
const set = { set_type: 'working' as const, weight_kg: '60', reps: 8, duration_seconds: null, distance_m: null, completed_at: null }

const row: OutboxRow = {
  id: 'p1', ownerId: 'u1', queuedAt: '', attempts: 0, error: null, exercises: [bench, squat],
  payload: {
    id: 'p1', routine_id: null, name: 'A', started_at: '2026-09-30T10:00:00Z', finished_at: '2026-09-30T11:00:00Z',
    plan_snapshot: null, feeling: 4, notes: '',
    exercises: [{ exercise_id: 'bench', notes: '', sets: [set, set] }, { exercise_id: 'squat', notes: '', sets: [] }],
  },
}

const view = (id: string, startedAt: string, status: SessionView['status'] = 'sent'): SessionView => ({
  id, name: id, startedAt, finishedAt: startedAt, feeling: null, notes: '', status, error: null, exercises: [],
})

describe('istorija', () => {
  it('neposlati trening dobija nazive vežbi i izostavlja vežbe bez serija', () => {
    const v = fromOutbox(row)
    expect(v.status).toBe('pending')
    expect(v.exercises.map((e) => e.exercise.name)).toEqual(['Bench'])
    expect(setCount(v)).toBe(2)
    expect(fromOutbox({ ...row, error: 'Odbijeno' }).status).toBe('rejected')
  })

  it('does not duplicate workouts repeated by overlapping history pages', () => {
    const first = [view('s1', '2026-09-29T10:00:00Z'), view('s2', '2026-09-28T10:00:00Z')]
    const overlap = [view('s2', '2026-09-28T10:00:00Z'), view('s3', '2026-09-27T10:00:00Z')]
    const local = [view('s2', '2026-09-28T10:00:00Z', 'pending')]
    expect(combineHistory([...first, ...overlap], local).map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('shows deletion pending even when an old server page still contains the session', () => {
    const result = combineHistory([view('old', '2026-09-30T10:00:00Z')], [view('old', '2026-09-30T10:00:00Z', 'deleting')])
    expect(result.map((s) => `${s.id}:${s.status}`)).toEqual(['old:deleting'])
  })

  it('spaja po datumu i ne ponavlja trening koji je u međuvremenu poslat', () => {
    const server = [view('s1', '2026-09-29T10:00:00Z'), view('p1', '2026-09-30T10:00:00Z')]
    const local = [view('p1', '2026-09-30T10:00:00Z', 'pending'), view('p2', '2026-09-30T18:00:00Z', 'pending')]
    expect(combineHistory(server, local).map((s) => `${s.id}:${s.status}`)).toEqual(['p2:pending', 'p1:sent', 's1:sent'])
  })
})

describe('formatWorkoutDuration', () => {
  const t = (key: string, o?: Record<string, unknown>) => `${key}:${JSON.stringify(o ?? {})}`
  it('minuti i sati umesto "0:07"', () => {
    expect(formatWorkoutDuration(20, t)).toBe('history.underMinute:{}')
    expect(formatWorkoutDuration(7 * 60 + 10, t)).toBe('history.minutes:{"m":7}')
    expect(formatWorkoutDuration(3600, t)).toBe('history.hours:{"h":1}')
    expect(formatWorkoutDuration(4 * 3600 + 13 * 60, t)).toBe('history.hoursMinutes:{"h":4,"m":13}')
  })
})
