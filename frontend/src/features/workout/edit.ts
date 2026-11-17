import type { WorkoutSession } from './api'
import { loggedToActiveSet, MAX_EXERCISE_NOTES, SetInputError, setResult, type ActiveExercise, type LoggedSet } from './model'
import { EMPTY_READINESS, type Readiness } from './rpe'
import { uuid } from '../../lib/uuid'

/**
 * Correcting a finished, synced workout. The exercises and times stay as they were done; the
 * athlete fixes set values (and may remove or add a set), notes, feeling and the check-in.
 */
export interface SessionEditDraft {
  id: string
  /** `updated_at` the draft was made from; the server refuses the edit if it moved on. */
  revision: string
  name: string
  feeling: number | null
  notes: string
  readiness: Readiness
  exercises: ActiveExercise[]
}

export interface SessionEditPayload {
  revision: string
  name: string
  feeling: number | null
  notes: string
  readiness: Readiness
  exercises: { exercise_id: string; notes: string; sets: (LoggedSet & { completed_at: string | null })[] }[]
}

/** Error on save: translation key and, when it is about one exercise, its name. */
export class SessionEditError extends Error {
  readonly key: string
  readonly exercise: string | null

  constructor(key: string, exercise: string | null = null) {
    super(key)
    this.key = key
    this.exercise = exercise
  }
}

export function sessionToEditDraft(session: WorkoutSession): SessionEditDraft {
  return {
    id: session.id,
    revision: session.updated_at ?? '',
    name: session.name,
    feeling: session.feeling,
    notes: session.notes,
    readiness: { ...EMPTY_READINESS, ...session.readiness },
    exercises: session.exercises.map((item) => ({
      key: uuid(),
      exercise: item.exercise,
      restSeconds: 0,
      notes: item.notes,
      sets: item.sets.map(loggedToActiveSet),
    })),
  }
}

/**
 * Request body for the correction. Validates like a live workout (same number rules); every
 * set counts as confirmed. Each set keeps its original time; a set added now has none.
 */
export function editDraftToPayload(draft: SessionEditDraft): SessionEditPayload {
  const name = draft.name.trim()
  if (!name) throw new SessionEditError('history.edit.errors.name')
  return {
    revision: draft.revision,
    name,
    feeling: draft.feeling,
    notes: draft.notes.trim(),
    // Always the whole check-in, so a cleared answer is cleared on the server too.
    readiness: { ...EMPTY_READINESS, ...draft.readiness },
    exercises: draft.exercises.map((item) => {
      if (!item.sets.length) throw new SessionEditError('history.edit.errors.noSets', item.exercise.name)
      try {
        return {
          exercise_id: item.exercise.id,
          notes: item.notes.slice(0, MAX_EXERCISE_NOTES),
          // RPE is always sent (null when cleared): the PUT replaces every set completely.
          sets: item.sets.map((set) => {
            const result = setResult({ ...set, done: true }, item.exercise)
            return { ...result, rpe: result.rpe ?? null, completed_at: set.completedAt }
          }),
        }
      } catch (error) {
        if (error instanceof SetInputError) throw new SessionEditError(error.message, item.exercise.name)
        throw error
      }
    }),
  }
}

/** True when the draft would save something different from what it started from. */
export function editChanged(initial: SessionEditDraft, draft: SessionEditDraft): boolean {
  const body = (d: SessionEditDraft) => {
    try {
      return JSON.stringify(editDraftToPayload(d))
    } catch {
      return null // an invalid draft is a change the athlete still has to fix
    }
  }
  const before = body(initial)
  const after = body(draft)
  return after === null || before !== after
}

/*
 * Unsaved corrections are kept on the device while the form is open, so Android Back, a
 * reload or the app being closed does not lose them: opening the same workout's edit again
 * brings them back. Stored per user and workout, for the revision they were made against.
 */
const draftKey = (ownerId: string, sessionId: string) => `pomak.sessionEdit.${ownerId}.${sessionId}`

export function storeEditDraft(ownerId: string, draft: SessionEditDraft): void {
  try {
    localStorage.setItem(draftKey(ownerId, draft.id), JSON.stringify(draft))
  } catch {
    // Storage full or blocked: the form still works, only recovery is unavailable.
  }
}

/** The kept draft, if it was made against this revision; a draft for an older one is dropped. */
export function loadEditDraft(ownerId: string, sessionId: string, revision: string): SessionEditDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(ownerId, sessionId))
    if (!raw) return null
    const draft = JSON.parse(raw) as SessionEditDraft
    if (draft.id === sessionId && draft.revision === revision && Array.isArray(draft.exercises)) return draft
    localStorage.removeItem(draftKey(ownerId, sessionId))
  } catch {
    // Unreadable entry: start from the server's version.
  }
  return null
}

export function clearEditDraft(ownerId: string, sessionId: string): void {
  try {
    localStorage.removeItem(draftKey(ownerId, sessionId))
  } catch {
    // Nothing to clean up.
  }
}

