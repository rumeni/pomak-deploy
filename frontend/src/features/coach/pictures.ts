import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api } from '../../lib/api'
import { getCurrentUserId } from '../../lib/currentUser'

const MAX_BYTES = 4 * 1024 * 1024

export class PictureError extends Error {}

/**
 * Shrink a photo on the device before sending (phone photos are often 5–10 MB; the server takes
 * at most 4 MB and re-encodes anyway). Upright, at most `maxSide` pixels, JPEG.
 */
export async function shrinkPicture(file: File, maxSide = 1600): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new PictureError('coach.pictures.notPicture')
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    bitmap = null
  }
  if (!bitmap) {
    if (file.size > MAX_BYTES) throw new PictureError('coach.pictures.tooLarge')
    return file
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) return file
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob || blob.size > MAX_BYTES) throw new PictureError('coach.pictures.tooLarge')
  return blob
}

/** Upload a picture for the next message of this conversation (connection or client address). */
export function useUploadPicture(address: { connection_id?: string; client_id?: string }) {
  return useMutation({
    networkMode: 'always',
    mutationFn: async (picture: Blob) => {
      const form = new FormData()
      form.append('file', picture, 'picture.jpg')
      if (address.connection_id) form.append('connection_id', address.connection_id)
      else if (address.client_id) form.append('client_id', address.client_id)
      return (await api.post<{ id: string; width: number; height: number }>('/coach/images/', form)).data
    },
  })
}

/** A picture behind authentication, as an object URL the page can show. */
export function usePicture(path: string | null) {
  return useQuery({
    queryKey: ['coach-picture', getCurrentUserId(), path],
    queryFn: async () => (await api.get<Blob>(path!, { responseType: 'blob' })).data,
    enabled: !!path,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
  })
}

// One object URL per fetched picture, shared by everything showing it and released a moment after
// the last one stops (so a component that React mounts twice never loses its URL).
const objectUrls = new WeakMap<Blob, { url: string; users: number }>()

function objectUrl(blob: Blob): { url: string; users: number } {
  let entry = objectUrls.get(blob)
  if (!entry) {
    entry = { url: URL.createObjectURL(blob), users: 0 }
    objectUrls.set(blob, entry)
  }
  return entry
}

/** The object URL of a fetched picture, released when no longer shown. */
export function usePictureUrl(path: string | null): { url: string | null; failed: boolean } {
  const picture = usePicture(path)
  const blob = picture.data
  useEffect(() => {
    if (!blob) return
    const entry = objectUrl(blob)
    entry.users += 1
    return () => {
      entry.users -= 1
      setTimeout(() => {
        if (entry.users === 0 && objectUrls.get(blob) === entry) {
          URL.revokeObjectURL(entry.url)
          objectUrls.delete(blob)
        }
      }, 0)
    }
  }, [blob])
  return { url: blob ? objectUrl(blob).url : null, failed: picture.isError }
}

/** The coach's picture path for his card (versioned, so a new picture is fetched again). */
export function coachPhotoPath(coach: { id: string; photo?: string | null }): string | null {
  return coach.photo && coach.id ? `/coach/photos/${coach.id}/?v=${encodeURIComponent(coach.photo)}` : null
}

export function useCoachPhoto() {
  const qc = useQueryClient()
  const done = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['coach-profile'] }),
    qc.invalidateQueries({ queryKey: ['coach-dashboard'] }),
    qc.invalidateQueries({ queryKey: ['coach-photo-version'] }),
  ])
  return {
    upload: useMutation({
      networkMode: 'always',
      mutationFn: async (picture: Blob) => {
        const form = new FormData()
        form.append('file', picture, 'photo.jpg')
        return (await api.put<{ photo: string | null }>('/coach/profile/photo/', form)).data
      },
      onSuccess: done,
    }),
    remove: useMutation({
      networkMode: 'always',
      mutationFn: async () => (await api.delete<{ photo: null }>('/coach/profile/photo/')).data,
      onSuccess: done,
    }),
  }
}
