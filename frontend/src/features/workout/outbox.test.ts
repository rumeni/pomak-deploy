import 'fake-indexeddb/auto'

import { AxiosError, AxiosHeaders } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../lib/db'
import type { SessionPayload } from './model'
import { classifySendError, finishWorkout, mergePrevious, pendingSessions, previousFromOutbox, syncOutbox } from './outbox'

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
    await db.activeWorkout.put({ slot: 'current', ownerId: 'u1', workout: {} as never })
    await finishWorkout('u1', payload('a', '2026-09-30T10:00:00Z'), [])
    expect(await db.activeWorkout.count()).toBe(0)
    expect((await pendingSessions('u1')).map((r) => r.id)).toEqual(['a'])
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

  it('istovremeni pozivi dele jedno slanje', async () => {
    await finishWorkout('u1', payload('a', '2026-09-30T12:00:00Z'), [])
    const send = vi.fn(async () => new Promise((r) => setTimeout(r, 10)))
    await Promise.all([syncOutbox('u1', send), syncOutbox('u1', send)])
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('classifySendError', () => {
  it('razlikuje privremene greške od odbijenih podataka', () => {
    expect(classifySendError(networkError()).result).toBe('retry-later')
    expect(classifySendError(httpError(500)).result).toBe('retry-later')
    expect(classifySendError(httpError(401)).result).toBe('retry-later')
    expect(classifySendError(httpError(429)).result).toBe('retry-later')
    expect(classifySendError(httpError(400, { detail: 'Loše' }))).toEqual({ result: 'rejected', message: 'Loše' })
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
