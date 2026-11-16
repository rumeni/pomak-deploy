import 'fake-indexeddb/auto'

import { AxiosError, AxiosHeaders } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../lib/db'
import type { SessionPayload } from './model'
import type { Exercise } from '../training/api'
import { classifySendError, discardOutboxItem, finishWorkout, mergePrevious, pendingSessions, previousFromOutbox, restoreRejectedWorkout, syncOutbox } from './outbox'
import { MAX_WORKOUT_SNAPSHOT_BYTES } from './model'

function payload(id: string, startedAt: string, exerciseId = 'bench', weight = '60'): SessionPayload {
  return {
    id,
    routine_id: null,
    name: `Trening ${id}`,
    started_at: startedAt,
    finished_at: startedAt,
    plan_snapshot: null,
    feeling: null,
    notes: '',
    exercises: [
      { exercise_id: exerciseId, notes: '', sets: [{ set_type: 'working', weight_kg: weight, reps: 8, duration_seconds: null, distance_m: null, completed_at: null }] },
    ],
  }
}

function httpError(status: number, data: unknown = {}): AxiosError {
  const headers = new AxiosHeaders()
  return new AxiosError('fail', 'ERR', undefined, undefined, { status, data, statusText: '', headers, config: { headers } })
}

const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK')

beforeEach(async () => {
  await db.outbox.clear()
  await db.activeWorkout.clear()
})

describe('finishWorkout', () => {
  it('upisuje u red i briše aktivan trening u istoj transakciji', async () => {
    await db.activeWorkout.put({ slot: 'u1', ownerId: 'u1', workout: {} as never })
    await finishWorkout('u1', payload('a', '2026-09-30T10:00:00Z'), [])
    expect(await db.activeWorkout.count()).toBe(0)
    expect((await pendingSessions('u1')).map((r) => r.id)).toEqual(['a'])
  })

  it('finishing B preserves A\'s unfinished workout on the same device', async () => {
    await db.activeWorkout.put({ slot: 'u1', ownerId: 'u1', workout: { name: 'A unfinished' } as never })
    await db.activeWorkout.put({ slot: 'u2', ownerId: 'u2', workout: { name: 'B finished' } as never })
    await finishWorkout('u2', payload('b', '2026-09-30T11:00:00Z'), [])
    expect((await db.activeWorkout.get('u1'))?.workout.name).toBe('A unfinished')
    expect(await db.activeWorkout.get('u2')).toBeUndefined()
  })

  it('red je odvojen po nalogu', async () => {
    await finishWorkout('u1', payload('a', '2026-09-30T10:00:00Z'), [])
    await finishWorkout('u2', payload('b', '2026-09-30T11:00:00Z'), [])
    expect((await pendingSessions('u1')).map((r) => r.id)).toEqual(['a'])
  })
})

describe('syncOutbox', () => {
  it('šalje najstarije prvo i briše poslate', async () => {
    await finishWorkout('u1', payload('novi', '2026-09-30T12:00:00Z'), [])
    await finishWorkout('u1', payload('stari', '2026-09-29T12:00:00Z'), [])
    const sent: string[] = []
    const report = await syncOutbox('u1', async (p) => void sent.push(p.id))
    expect(sent).toEqual(['stari', 'novi'])
    expect(report).toEqual({ sent: 2, rejected: 0, pending: 0 })
    expect(await db.outbox.count()).toBe(0)
  })

  it('repairs an older oversized queued snapshot at upload without touching its logged sets', async () => {
    const old = payload('oversized', '2026-09-30T10:00:00Z')
    old.plan_snapshot = {
      id: 'r1', name: 'Huge', created_at: '', updated_at: '',
      notes: 'n'.repeat(300_000),
      exercises: [],
    }
    await finishWorkout('u1', old, [])
    const send = vi.fn(async (ready: SessionPayload) => {
      expect(JSON.stringify(ready.plan_snapshot).length).toBeLessThan(MAX_WORKOUT_SNAPSHOT_BYTES)
      expect(ready.exercises).toEqual(old.exercises)
      expect(ready.id).toBe('oversized')
    })
    expect((await syncOutbox('u1', send)).sent).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('bez interneta staje i ništa ne gubi', async () => {
    await finishWorkout('u1', payload('a', '2026-09-29T12:00:00Z'), [])
    await finishWorkout('u1', payload('b', '2026-09-30T12:00:00Z'), [])
    const send = vi.fn().mockRejectedValue(networkError())
    const report = await syncOutbox('u1', send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(report).toEqual({ sent: 0, rejected: 0, pending: 2 })
    expect((await db.outbox.get('a'))?.attempts).toBe(1)
  })

  it('odbijen trening (400) dobija poruku, ne šalje se ponovo, a ostali idu dalje', async () => {
    await finishWorkout('u1', payload('los', '2026-09-29T12:00:00Z'), [])
    await finishWorkout('u1', payload('dobar', '2026-09-30T12:00:00Z'), [])
    const send = vi.fn(async (p: SessionPayload) => {
      if (p.id === 'los') throw httpError(400, { non_field_errors: ['Trening nema nijednu potvrđenu seriju.'] })
    })
    expect(await syncOutbox('u1', send)).toEqual({ sent: 1, rejected: 1, pending: 0 })
    expect((await db.outbox.get('los'))?.error).toBe('Trening nema nijednu potvrđenu seriju.')

    send.mockClear()
    await syncOutbox('u1', send)
    expect(send).not.toHaveBeenCalled()
  })

  it('ne šalje tuđe treninge', async () => {
    await finishWorkout('u2', payload('tudji', '2026-09-30T12:00:00Z'), [])
    const send = vi.fn()
    await syncOutbox('u1', send)
    expect(send).not.toHaveBeenCalled()
  })

  it('promena naloga tokom slanja ne brise red koji pripada staroj sesiji', async () => {
    await finishWorkout('u1', payload('a', '2026-09-30T12:00:00Z'), [])
    await finishWorkout('u2', payload('b', '2026-09-30T12:00:00Z'), [])
    let active = true
    let complete!: () => void
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => { started = resolve })
    const send = vi.fn(async () => {
      started()
      await new Promise<void>((resolve) => { complete = resolve })
    })
    const first = syncOutbox('u1', send, () => active, 'session-a')
    await startedPromise
    active = false
    complete()
    await first
    expect(await db.outbox.get('a')).toBeDefined()
    await syncOutbox('u2', async () => undefined, () => true, 'session-b')
    expect(await db.outbox.get('b')).toBeUndefined()
    expect(await db.outbox.get('a')).toBeDefined()
  })

  it('istovremeni pozivi dele jedno slanje', async () => {
    await finishWorkout('u1', payload('a', '2026-09-30T12:00:00Z'), [])
    const send = vi.fn(async () => new Promise((r) => setTimeout(r, 10)))
    await Promise.all([syncOutbox('u1', send), syncOutbox('u1', send)])
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('durable workout deletion reconciliation (#47)', () => {
  it('discards a never-uploaded workout locally without contacting the server', async () => {
    await finishWorkout('u1', payload('local', '2026-09-30T10:00:00Z'), [])
    await discardOutboxItem('u1', 'local')
    expect(await db.outbox.get('local')).toBeUndefined()
  })

  it('does not delete local identity until a concurrent POST is followed by DELETE', async () => {
    await finishWorkout('u1', payload('race', '2026-09-30T10:00:00Z'), [])
    let sendStarted!: () => void
    let finishSend!: () => void
    const started = new Promise<void>((resolve) => { sendStarted = resolve })
    const continueSend = new Promise<void>((resolve) => { finishSend = resolve })
    let posted = false
    const send = vi.fn(async () => {
      sendStarted()
      await continueSend
      posted = true
    })
    const remove = vi.fn(async (id: string) => {
      expect(posted).toBe(true)
      expect(id).toBe('race')
    })
    const running = syncOutbox('u1', send, () => true, 'race-session', remove)
    await started
    await discardOutboxItem('u1', 'race')
    const tombstone = (await db.outbox.get('race'))!
    expect(tombstone.deleteRequested).toBe(true)
    expect(tombstone.payload.exercises).toEqual([])
    expect(tombstone.exercises).toEqual([])
    finishSend()
    const report = await running
    expect(send).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(report.deleted).toBe(1)
    expect(report.sent).toBe(0)
    expect(await db.outbox.get('race')).toBeUndefined()
  })

  it('reconciles an upload whose HTTP response was lost and retries a failed DELETE', async () => {
    await finishWorkout('u1', payload('uncertain', '2026-09-30T10:00:00Z'), [])
    const send = vi.fn().mockRejectedValue(networkError())
    expect((await syncOutbox('u1', send)).pending).toBe(1)
    expect((await db.outbox.get('uncertain'))?.attempts).toBe(1)

    await discardOutboxItem('u1', 'uncertain')
    const remove = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce(undefined)
    const first = await syncOutbox('u1', send, () => true, 'recovery1', remove)
    expect(first.deleted).toBeUndefined()
    expect((await db.outbox.get('uncertain'))?.deleteRequested).toBe(true)
    const second = await syncOutbox('u1', send, () => true, 'recovery2', remove)
    expect(second.deleted).toBe(1)
    expect(await db.outbox.get('uncertain')).toBeUndefined()
    expect(send).toHaveBeenCalledTimes(1) // Never reupload after delete intent.
  })

  it('accepts 404 as deletion confirmed and never erases a different account', async () => {
    await finishWorkout('u1', payload('known', '2026-09-30T10:00:00Z'), [])
    await db.outbox.update('known', { attempts: 1 })
    await expect(discardOutboxItem('u2', 'known')).rejects.toThrow('NOT_FOUND')
    expect((await db.outbox.get('known'))?.deleteRequested).toBeUndefined()
    await discardOutboxItem('u1', 'known')
    expect((await syncOutbox('u1', vi.fn(), () => true, 'delete404',
      async () => { throw httpError(404) })).deleted).toBe(1)
    expect(await db.outbox.get('known')).toBeUndefined()
  })

  it('recreates only a delete tombstone when POST completed just before user tapped Delete', async () => {
    await finishWorkout('u1', payload('sent', '2026-09-30T10:00:00Z'), [])
    await syncOutbox('u1', async () => undefined)
    expect(await db.outbox.get('sent')).toBeUndefined()
    await discardOutboxItem('u1', 'sent')
    expect((await db.outbox.get('sent'))?.deleteRequested).toBe(true)
    const remove = vi.fn().mockResolvedValue(undefined)
    await syncOutbox('u1', vi.fn(), () => true, 'after-sent', remove)
    expect(remove).toHaveBeenCalledWith('sent')
    expect(await db.outbox.get('sent')).toBeUndefined()
  })
})

describe('classifySendError', () => {
  it('razlikuje privremene greške od odbijenih podataka', () => {
    expect(classifySendError(networkError()).result).toBe('retry-later')
    expect(classifySendError(httpError(500)).result).toBe('retry-later')
    expect(classifySendError(httpError(401)).result).toBe('retry-later')
    expect(classifySendError(httpError(429)).result).toBe('retry-later')
    expect(classifySendError(httpError(400, { detail: 'Loše' }))).toEqual({ result: 'rejected', message: 'Loše' })
    expect(classifySendError(httpError(400, { started_at: ['Workout cannot start in the future.'] })).result).toBe('retry-later')
  })
})

describe('prošli rezultati sa telefona', () => {
  it('uzima najnoviji neposlati trening i spaja sa serverom po datumu', async () => {
    await finishWorkout('u1', payload('star', '2026-09-28T12:00:00Z', 'bench', '55'), [])
    await finishWorkout('u1', payload('nov', '2026-09-30T12:00:00Z', 'bench', '62.5'), [])
    const local = previousFromOutbox(await pendingSessions('u1'), ['bench', 'squat'])
    expect(Object.keys(local)).toEqual(['bench'])
    expect(local.bench.sets[0].weight_kg).toBe('62.5')

    const server = {
      bench: { session_id: 's', started_at: '2026-09-29T12:00:00Z', sets: [] },
      squat: { session_id: 's', started_at: '2026-09-29T12:00:00Z', sets: [] },
    }
    const merged = mergePrevious(server, local)
    expect(merged.bench.session_id).toBe('nov')
    expect(merged.squat.session_id).toBe('s')
  })
})

describe('restore rejected offline workout', () => {
  const exercise: Exercise = {
    id: 'bench', name: 'Bench', aliases: '', equipment: 'barbell', measurement: 'weight_reps',
    load_mode: 'total', muscle: 'chest', instructions: '', is_custom: false,
  }

  it('recovers sets, notes and session identity atomically for editing', async () => {
    const body = payload('rejected', '2026-09-29T10:00:00Z')
    body.feeling = 4
    body.notes = 'Previous notes'
    await finishWorkout('u1', body, [exercise])
    await db.outbox.update('rejected', { error: 'Too long' })

    await restoreRejectedWorkout('u1', 'rejected')
    const active = await db.activeWorkout.get('u1')
    expect(active?.workout.id).toBe('rejected')
    expect(active?.workout.draftFeeling).toBe(4)
    expect(active?.workout.draftNotes).toBe('Previous notes')
    expect(active?.workout.recoveredFinishedAt).toBe(body.finished_at)
    expect(active?.workout.exercises[0].sets[0]).toMatchObject({ done: true, reps: '8', weight: '60' })
    expect(await db.outbox.get('rejected')).toBeUndefined()
  })

  it('A\'s active workout does not block B from restoring B\'s rejected workout', async () => {
    await finishWorkout('u2', payload('other', '2026-09-29T10:00:00Z'), [exercise])
    await db.outbox.update('other', { error: 'Invalid' })
    await db.activeWorkout.put({ slot: 'u1', ownerId: 'u1', workout: { name: 'A unfinished' } as never })
    await restoreRejectedWorkout('u2', 'other')
    expect((await db.activeWorkout.get('u1'))?.workout.name).toBe('A unfinished')
    expect((await db.activeWorkout.get('u2'))?.workout.id).toBe('other')
  })

  it('restoring a rejected workout also repairs an oversized snapshot', async () => {
    const old = payload('old', '2026-09-29T10:00:00Z')
    old.plan_snapshot = {
      id: 'routine', name: 'Large', notes: 'x'.repeat(300_000),
      created_at: '', updated_at: '', exercises: [],
    }
    await finishWorkout('u1', old, [exercise])
    await db.outbox.update('old', { error: 'The workout plan snapshot is too large.' })
    await restoreRejectedWorkout('u1', 'old')
    const restored = await db.activeWorkout.get('u1')
    expect(restored?.workout.id).toBe('old')
    expect(JSON.stringify(restored?.workout.planSnapshot).length).toBeLessThan(MAX_WORKOUT_SNAPSHOT_BYTES)
    expect(restored?.workout.exercises[0].sets[0]).toMatchObject({ weight: '60', reps: '8', done: true })
  })

  it('never overwrites an active workout or another user’s queued workout', async () => {
    await finishWorkout('u1', payload('one', '2026-09-29T10:00:00Z'), [exercise])
    await db.outbox.update('one', { error: 'Invalid' })
    await expect(restoreRejectedWorkout('u2', 'one')).rejects.toThrow('NOT_FOUND')
    await db.activeWorkout.put({ slot: 'u1', ownerId: 'u1', workout: {} as never })
    await expect(restoreRejectedWorkout('u1', 'one')).rejects.toThrow('ACTIVE_WORKOUT_EXISTS')
    expect(await db.outbox.get('one')).toBeDefined()
  })
})
