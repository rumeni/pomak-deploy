import { useEffect, useState } from 'react'

/** Trenutno vreme koje se osvežava svake sekunde (tajmeri, trajanje treninga). */
export function useNow(active = true): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}
