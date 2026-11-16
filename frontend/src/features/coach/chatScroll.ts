interface RestorePosition { top: number; height: number }

export function nearChatBottom(top: number, viewport: number, height: number): boolean {
  return height - top - viewport <= 48
}

/**
 * Return the new scroll offset or null to leave the reader alone.
 * Restoring a prepended page wins over any auto-scroll-to-bottom behavior.
 */
export function chatScrollTop(options: {
  previousCount: number
  count: number
  nearBottom: boolean
  scrollHeight: number
  restore: RestorePosition | null
}): number | null {
  const { previousCount, count, nearBottom, scrollHeight, restore } = options
  if (restore) return restore.top + scrollHeight - restore.height
  if (count === 0) return null
  if (previousCount === 0 || (count > previousCount && nearBottom)) return scrollHeight
  return null
}
