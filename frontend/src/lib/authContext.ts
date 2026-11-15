import { createContext, useContext } from 'react'
import type { Me } from './types'

export interface RegisterData {
  email: string
  password: string
  displayName: string
  accountType: 'client' | 'coach'
}

interface AuthState {
  me: Me | undefined
  loading: boolean
  /** Prijava postoji, ali server nije dostupan, a podaci o korisniku nisu sačuvani na telefonu. */
  unreachable: boolean
  retry: () => void
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth mora biti unutar AuthProvider-a')
  return ctx
}
