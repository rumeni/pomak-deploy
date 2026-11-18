import { createContext } from 'react'

/**
 * Where the statistics link to. The athlete's own screens by default; a coach viewing a client
 * gets the client's workout review instead, and no link to the athlete's own exercise pages.
 */
export interface StatsLinks {
  exercise: (exerciseId: string) => string | null
  session: (sessionId: string) => string | null
}

export const StatsLinksContext = createContext<StatsLinks>({
  exercise: (id) => `/napredak/vezba/${id}`,
  session: (id) => `/trening/istorija/${id}`,
})
