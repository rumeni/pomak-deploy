import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Exercise } from './api'
import {
  clearUserPendingPrograms,
  createRoutines,
  describePrescription,
  importProgram,
  isImportingProgram,
  loadPendingProgram,
  ProgramImportAuthChanged,
  programToRoutines,
  programAlreadyAdded,
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
    expect(routines.map((r) => r.program_key)).toEqual([program.key, program.key])
    expect(routines[0].exercises[0]).toMatchObject({ exercise_id: 'e-bench', rest_seconds: 120 })
    expect(routines[0].exercises[0].sets).toHaveLength(3)
    expect(routines[0].exercises[0].sets[0]).toEqual(set)
    // A copy, not the same objects: editing the routine never changes the suggestion.
    expect(routines[0].exercises[0].sets[0]).not.toBe(set)
  })

  it('recognises an imported program after a language switch or routine rename', () => {
    const translated = { ...program, name: 'Full body for beginners', routines: [
      { ...program.routines[0], name: 'Full body A' },
      { ...program.routines[1], name: 'Full body B' },
    ] }
    const imported = { name: 'My own A', notes: 'Celo telo za početnike', program_key: program.key }
    expect(programAlreadyAdded(translated, [imported])).toBe(true)
    expect(programAlreadyAdded(translated, [{ ...imported, program_key: 'other' }])).toBe(false)
    expect(programAlreadyAdded(program, [{ name: 'Celo telo A', notes: program.name, program_key: '' }])).toBe(true)
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
    /** A create-only server: an existing ID answers 'exists' and is never changed. */
    const server = () => {
      const routines = new Map<string, { name: string }>()
      const created: string[] = []
      const create = async (body: { id?: string; name: string }): Promise<'created' | 'exists'> => {
        if (routines.has(body.id!)) return 'exists'
        created.push(body.id!)
        routines.set(body.id!, { name: body.name })
        return 'created'
      }
      return { routines, created, create }
    }

    it('resuming never changes a routine that exists, so later edits survive', async () => {
      const api = server()
      const batch = programToRoutines(program, ids())
      // First attempt: routine 1 is created but its response is lost.
      let lose = true
      await expect(importProgram('athlete-1', program.key, { batch, done: [] }, {
        isCurrent: () => true,
        create: async (body) => {
          const result = await api.create(body)
          if (lose) { lose = false; throw new Error('timeout') }
          return result
        },
      })).rejects.toThrow('timeout')
      api.routines.set(batch[0].id!, { name: 'Moj A' }) // the athlete edits routine 1
      // Retry after leaving and coming back (language changed too): the stored record resumes.
      const stored = loadPendingProgram('athlete-1', { ...program, name: 'Beginner full body' })!
      expect(stored.batch.map((b) => b.id)).toEqual(batch.map((b) => b.id))
      await importProgram('athlete-1', program.key, stored, { isCurrent: () => true, create: api.create })
      expect(api.created).toEqual([batch[0].id, batch[1].id])
      expect(api.routines.get(batch[0].id!)).toEqual({ name: 'Moj A' })
    })

    it('two tabs importing the same program at once: each routine made once, none overwritten', async () => {
      const api = server()
      const batch = programToRoutines(program, ids())
      // Both tabs load the same stored batch (the second one opened while the first ran).
      const tabA = { batch, done: [] as string[] }
      const tabB = { batch, done: [] as string[] }
      let releaseA!: () => void
      const gateA = new Promise<void>((resolve) => { releaseA = resolve })
      const runA = importProgram('athlete-1', program.key, tabA, {
        isCurrent: () => true,
        create: async (body) => { await gateA; return api.create(body) },
      })
      // Tab B is another JavaScript runtime: simulate it by finishing first, through the server.
      for (const body of batch) await api.create(body)
      api.routines.set(batch[0].id!, { name: 'Moj A' }) // edited in tab B meanwhile
      releaseA()
      await runA
      expect(api.created).toEqual(batch.map((b) => b.id))
      expect(api.routines.get(batch[0].id!)).toEqual({ name: 'Moj A' })
      expect(tabB.done).toEqual([])
      expect(storage.size).toBe(0)
    })

    it('progress written by another tab for the same batch is merged, not erased', async () => {
      const api = server()
      const batch = programToRoutines(program, ids())
      // Another tab already finished routine 2 and stored that.
      storage.set(`pomak.pendingProgram.athlete-1.${program.key}`, JSON.stringify({ batch, done: [batch[1].id] }))
      let stop = true
      await expect(importProgram('athlete-1', program.key, { batch, done: [] }, {
        isCurrent: () => true,
        create: async (body) => {
          const result = await api.create(body)
          if (stop) { stop = false; throw new Error('timeout') }
          return result
        },
      })).rejects.toThrow('timeout')
      expect(loadPendingProgram('athlete-1', program)?.done).toEqual([batch[1].id])
    })

    it('stops when the login changes and keeps the record with the original account', async () => {
      const api = server()
      const batch = programToRoutines(program, ids())
      let current = true
      await expect(importProgram('athlete-1', program.key, { batch, done: [] }, {
        isCurrent: () => current,
        create: async (body) => { const r = await api.create(body); current = false; return r }, // logged out after the first
      })).rejects.toBeInstanceOf(ProgramImportAuthChanged)
      expect(api.created).toEqual([batch[0].id])
      // Nothing is written after the login changed; resuming later gets 'exists' for routine 1.
      expect(loadPendingProgram('athlete-1', program)?.done).toEqual([])
      expect(loadPendingProgram('athlete-2', program)).toBeNull()
    })

    it('a late answer after logout cleanup never brings the record back', async () => {
      const api = server()
      let release!: () => void
      const create = (body: { id?: string; name: string }) => new Promise<'created' | 'exists'>((resolve) => {
        release = () => { void api.create(body).then(resolve) }
      })
      const run = importProgram('athlete-1', program.key, { batch: programToRoutines(program, ids()), done: [] },
        { isCurrent: () => true, create })
      await Promise.resolve()
      clearUserPendingPrograms('athlete-1') // logout or account deletion while the POST is out
      release()
      await expect(run).rejects.toBeInstanceOf(ProgramImportAuthChanged)
      expect([...storage.keys()]).toEqual([])
    })

    it('starting the same import again while it runs joins it instead of a second loop', async () => {
      const api = server()
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const deps = {
        isCurrent: () => true,
        create: async (body: { id?: string; name: string }) => { await gate; return api.create(body) },
      }
      const record = { batch: programToRoutines(program, ids()), done: [] }
      const first = importProgram('athlete-1', program.key, record, deps)
      expect(isImportingProgram('athlete-1', program.key)).toBe(true)
      // Leave and reopen the screen, tap "Add" again (even with a new batch): the same import.
      const second = importProgram('athlete-1', program.key, { batch: programToRoutines(program, () => crypto.randomUUID()), done: [] }, deps)
      expect(second).toBe(first)
      release()
      await Promise.all([first, second])
      expect(api.created).toEqual(record.batch.map((b) => b.id))
      expect(isImportingProgram('athlete-1', program.key)).toBe(false)
    })

    it('clears its record on success by itself, whether or not the screen is still open', async () => {
      const api = server()
      await importProgram('athlete-1', program.key, { batch: programToRoutines(program, ids()), done: [] },
        { isCurrent: () => true, create: api.create })
      expect(storage.size).toBe(0)
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
