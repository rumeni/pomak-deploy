import type { Target } from './api'

/** Cilj koji važi na dan (poslednji koji je počeo tog dana ili ranije); lista je od najnovijeg. */
export function targetOn(targets: Target[], date: string): Target | undefined {
  return targets.find((t) => t.valid_from <= date)
}
