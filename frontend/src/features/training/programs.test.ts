import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Exercise } from './api'
import {
  clearUserPendingPrograms,
  createRoutines,
  describePrescription,
  importProgram,
  loadPendingProgram,
  ProgramImportAuthChanged,
  programToRoutines,
  type Program,
} from './programs'

const bench: Exercise = {
  id: 'e-bench', slug: 'bench-press', name: 'Bench', aliases: '', equipment: 'barbell', measurement: 'weight_reps',
  load_mode: 'total', muscle: 'chest', instructions: '', is_custom: false,
}
const plank: Exercise = { ...bench, id: 'e-plank', slug: 'plank', measurement: 'duration', muscle: 'core' }
const set = { set_type: 'working' as const, reps_min: 8, reps_max: 10, weight_kg: null, duration_seconds: null, distance_m: null, rpe: '6.5' }

const program: Program = {
  key: 'full-body-beginner', sex: 'male', level: 'beginner', days: 3, recommended: true,
  name: 'Celo telo za početnike', description: '',
  routines: [
    { name: 'Celo telo A', exercises: [
      { exercise: bench, rest_seconds: 120, notes: '', sets: [set, set, set] },
      { exercise: plank, rest_seconds: 60, notes: '', sets: [{ ...set, reps_min: null, reps_max: null, duration_seconds: 45, rpe: null }] },
    ] },
    { name: 'Celo telo B', exercises: [{ exercise: bench, rest_seconds: 120, notes: '', sets: [set] }] },
  ],
}

describe('suggested programs', () => {
  it('copies every routine with new IDs, the program name as a note and the prescriptions', () => {
    let n = 0
    const routines = programToRoutines(program, () => `id-${++n}`)
    expect(routines.map((r) => [r.id, r.name, r.notes])).toEqual([
      ['id-1', 'Celo telo A', 'Celo telo za početnike'],
      ['id-2', 'Celo telo B', 'Celo telo za početnike'],
    ])
    expect(routines[0].exercises[0]).toMatchObject({ exercise_id: 'e-bench', rest_seconds: 120 })
    expect(routines[0].exercises[0].sets).toHaveLength(3)
    expect(routines[0].exercises[0].sets[0]).toEqual(set)
    // A copy, not the same objects: editing the routine never changes the suggestion.
    expect(routines[0].exercises[0].sets[0]).not.toBe(set)
  })

  it('describes the prescription for the preview', () => {
    expect(describePrescription(program.routines[0].exercises[0], 's')).toBe('3 × 8–10 @ 6,5')
    expect(describePrescription(program.routines[0].exercises[1], 's')).toBe('1 × 45 s')
  })

  describe('importing a program (stored progress, never overwriting)', () => {
    const storage = new Map<string, string>()
    beforeEach(() => {
      storage.clear()
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value) },
        removeItem: (key: string) => { storage.delete(key) },
        key: (i: number) => [...storage.keys()][i] ?? null,
        get length() { return storage.size },
      })
    })
    afterEach(() => vi.unstubAllGlobals())

    const ids = () => {
      const list = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
      return () => list.shift()!
    }
    /** A server with routines by ID; `created` lists every POST it received. */
    const server = () => {
      const routines = new Map<string, unknown>()
      const created: string[] = []
      return {
        routines, created,
        exists: async (id: string) => routines.has(id),
        create: async (body: { id?: string }) => { created.push(body.id!); routines.set(body.id!, body) },
      }
    }

    it('resuming never re-sends a routine that exists, so later edits survive', async () => {
      const api = server()
      const batch = programToRoutines(program, ids())
      // First attempt: routine 1 is created but its response is lost (the call "fails").
      let lose = true
      await expect(importProgram('athlete-1', program.key, { batch, done: [] }, {
        isCurrent: () => true,
        exists: api.exists,
        create: async (body) => {
          await api.create(body)
          if (lose) { lose = false; throw new Error('timeout') }
        },
      })).rejects.toThrow('timeout')
      // The athlete edits routine 1 meanwhile.
      api.routines.set(batch[0].id!, { ...batch[0], name: 'Moj A' })
      // Retry after leaving and coming back (language changed too): the stored record resumes.
      const stored = loadPendingProgram('athlete-1', { ...program, name: 'Beginner full body' })!
      expect(stored.batch.map((b) => b.id)).toEqual(batch.map((b) => b.id))
      await importProgram('athlete-1', program.key, stored, { isCurrent: () => true, exists: api.exists, create: api.create })
      expect(api.created).toEqual([batch[0].id, batch[1].id]) // routine 1 was not sent again
      expect(api.routines.get(batch[0].id!)).toMatchObject({ name: 'Moj A' })
    })

    it('stops when the login changes and keeps the record with the original account', async () => {
      const api = server()
      const batch = programToRoutines(program, ids())
      let current = true
      await expect(importProgram('athlete-1', program.key, { batch, done: [] }, {
        isCurrent: () => current,
        exists: api.exists,
        create: async (body) => { await api.create(body); current = false }, // logged out after the first
      })).rejects.toBeInstanceOf(ProgramImportAuthChanged)
      expect(api.created).toEqual([batch[0].id])
      expect(loadPendingProgram('athlete-1', program)?.done).toEqual([batch[0].id])
      expect(loadPendingProgram('athlete-2', program)).toBeNull()
    })

    it('clears its record on success by itself, whether or not the screen is still open', async () => {
      const api = server()
      await importProgram('athlete-1', program.key, { batch: programToRoutines(program, ids()), done: [] },
        { isCurrent: () => true, exists: api.exists, create: api.create })
      expect(storage.size).toBe(0)
      // A fresh import never asks the server first.
      expect(api.created).toHaveLength(2)
    })

    it('reads records stored by the previous version (a bare batch)', () => {
      const batch = programToRoutines(program, ids())
      storage.set(`pomak.pendingProgram.athlete-1.${program.key}`, JSON.stringify(batch))
      expect(loadPendingProgram('athlete-1', program)).toEqual({ batch, done: [] })
    })

    it('logout clears only that account\'s unfinished imports', () => {
      storage.set('pomak.pendingProgram.athlete-1.a', '[]')
      storage.set('pomak.pendingProgram.athlete-1.b', '[]')
      storage.set('pomak.pendingProgram.athlete-2.a', '[]')
      storage.set('pomak.language.athlete-1', 'sr')
      clearUserPendingPrograms('athlete-1')
      expect([...storage.keys()].sort()).toEqual(['pomak.language.athlete-1', 'pomak.pendingProgram.athlete-2.a'])
    })
  })

  it('resumes a failed or lost import with the same routine IDs instead of new copies', async () => {
    let n = 0
    const batch = programToRoutines(program, () => `id-${++n}`)
    const saved = new Map<string, unknown>()
    let failAt: string | null = 'id-2'
    // A server that keeps creates by ID (repeating one returns the existing routine).
    const post = async (body: { id?: string }) => {
      if (body.id === failAt) throw new Error('timeout')
      saved.set(body.id!, body)
    }
    await expect(createRoutines(batch, post)).rejects.toThrow('timeout')
    failAt = null
    await createRoutines(batch, post) // the retry
    expect([...saved.keys()]).toEqual(['id-1', 'id-2'])
    expect(n).toBe(2) // no new IDs were made for the retry
  })
})
