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
  previousNewestId: string | null
  newestId: string | null
  nearBottom: boolean
  scrollHeight: number
  restore: RestorePosition | null
}): number | null {
  const { previousCount, count, previousNewestId, newestId, nearBottom, scrollHeight, restore } = options
  if (restore) return restore.top + scrollHeight - restore.height
  if (count === 0) return null
  // A full 80-message page is a sliding window: incoming messages replace
  // older ones without changing count. Follow the newest ID as well.
  if (previousCount === 0 || (nearBottom && (count > previousCount || newestId !== previousNewestId))) return scrollHeight
  return null
}
