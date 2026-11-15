import type { Exercise } from './api'
import { EXERCISE_IMAGE_SLUGS } from './exerciseImages'

export type WithSlug = Pick<Exercise, 'name' | 'muscle'> & { slug?: string | null }

/** Početni i završni položaj (Everkinetic crteži u public/exercises), ili null ako vežba nema crtež. */
export function exerciseImageUrls(exercise: WithSlug): [string, string] | null {
  const slug = exercise.slug
  if (!slug || !EXERCISE_IMAGE_SLUGS.has(slug)) return null
  const base = `${import.meta.env.BASE_URL}exercises/${slug}`
  return [`${base}-1.svg`, `${base}-2.svg`]
}

