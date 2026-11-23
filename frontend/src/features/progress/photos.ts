import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api } from '../../lib/api'
import { getCurrentUserId } from '../../lib/currentUser'

export type Pose = 'front' | 'side' | 'back'
export const POSES: Pose[] = ['front', 'side', 'back']

/** A progress photo (the picture itself is fetched separately, behind authentication). */
export interface ProgressPhoto {
  id: string
  taken_on: string
  pose: Pose
  note: string
  width: number
  height: number
}

/**
 * Where the photos come from: the athlete's own, or a client's for his coach. A client's photos
 * are cached per access version: what was loaded under an earlier consent is never reused.
 */
export type PhotoSource = { kind: 'own' } | { kind: 'client'; clientId: string; accessVersion: number }

export function photosPath(source: PhotoSource): string {
  return source.kind === 'own' ? '/progress/photos/' : `/coach/clients/${source.clientId}/photos/`
}

export function imagePath(source: PhotoSource, id: string): string {
  const path = `${photosPath(source)}${id}/image/`
  return source.kind === 'own' ? path : `${path}?v=${source.accessVersion}`
}

const photosKey = (source: PhotoSource) =>
  ['progress-photos', getCurrentUserId(), ...(source.kind === 'own' ? ['own'] : [source.clientId, source.accessVersion])]

/** Newest first; null for a coach while the client does not share measurements. */
export function useProgressPhotos(source: PhotoSource) {
  return useQuery({
    queryKey: photosKey(source),
    queryFn: async () => (await api.get<ProgressPhoto[] | null>(photosPath(source))).data,
  })
}

/**
 * Forgets a client's photos on this device: the list and every fetched picture. For when the
 * coach loses access or the client stops sharing measurements.
 */
export function forgetClientPhotos(qc: QueryClient, clientId: string): void {
  const prefix = `/coach/clients/${clientId}/photos/`
  qc.removeQueries({ predicate: ({ queryKey: key }) =>
    (key[0] === 'progress-photos' && key[2] === clientId)
    || (key[0] === 'coach-picture' && typeof key[2] === 'string' && key[2].startsWith(prefix)) })
}

export function useUploadPhoto() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (input: { id: string; picture: Blob; taken_on: string; pose: Pose; note: string }) => {
      const form = new FormData()
      form.append('id', input.id)
      form.append('taken_on', input.taken_on)
      form.append('pose', input.pose)
      form.append('note', input.note)
      form.append('file', input.picture, 'photo.jpg')
      return (await api.post<ProgressPhoto>('/progress/photos/', form)).data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: photosKey({ kind: 'own' }) }),
  })
}

export function useDeletePhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/progress/photos/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: photosKey({ kind: 'own' }) }),
  })
}

/** The two photos to compare, oldest on the left (before -> after). */
export function comparePair(photos: ProgressPhoto[], selected: string[]): [ProgressPhoto, ProgressPhoto] | null {
  const chosen = photos.filter((p) => selected.includes(p.id))
  if (chosen.length !== 2) return null
  const [a, b] = chosen
  return a.taken_on <= b.taken_on ? [a, b] : [b, a]
}

/** Tapping a photo picks it for the comparison; a third pick replaces the oldest pick. */
export function toggleSelected(selected: string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id)
  return [...selected, id].slice(-2)
}
