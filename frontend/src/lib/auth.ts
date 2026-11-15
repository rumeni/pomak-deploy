// Stable public auth API; keep shared hooks and context out of React component modules.
export { AuthProvider } from './authProvider'
export { useAuth } from './authContext'
export type { AuthState, RegisterData } from './authContext'
