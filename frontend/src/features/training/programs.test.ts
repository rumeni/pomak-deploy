import { describe, expect, it, vi } from 'vitest'

import type { Exercise } from './api'
import { clearPendingProgram, createRoutines, describePrescription, loadPendingProgram, programToRoutines, savePendingProgram, type Program } from './programs'

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

  it('resumes after unmount/reopen and a language change using the stored batch', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
    })
    try {
      const ids = [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ]
      const batch = programToRoutines(program, () => ids.shift()!)
      savePendingProgram('athlete-1', program.key, batch)
      const stored = loadPendingProgram('athlete-1', { ...program, name: 'Beginner full body' })
      expect(stored).toEqual(batch)
      expect(loadPendingProgram('athlete-2', program)).toBeNull()

      const records = new Set<string>()
      let failOnSecond = true
      const post = async (body: { id?: string }) => {
        if (body.id === batch[1].id && failOnSecond) {
          failOnSecond = false
          throw new Error('timeout')
        }
        records.add(body.id!)
      }
      await expect(createRoutines(batch, post)).rejects.toThrow('timeout')
      await createRoutines(loadPendingProgram('athlete-1', program)!, post)
      expect([...records]).toEqual(batch.map((body) => body.id))
      clearPendingProgram('athlete-1', program.key)
      expect(loadPendingProgram('athlete-1', program)).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
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
