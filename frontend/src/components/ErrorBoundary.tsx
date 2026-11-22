import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'

interface Props {
  children: ReactNode
  /** When this changes (e.g. the route), a shown error is cleared so the next screen can render. */
  resetKey?: string
  /** Hook for error reporting (e.g. Sentry later); console in the meantime. */
  onError?: (error: unknown, info: ErrorInfo) => void
}

interface State { error: unknown; resetKey?: string }

/**
 * Catches render errors so one broken screen shows a recovery message instead of a blank app.
 * Unfinished workouts and queued changes live in IndexedDB, so retrying or reloading loses nothing.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error('Unknown render error') }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (this.props.onError) this.props.onError(error, info)
    else console.error('Screen failed to render', error, info.componentStack)
  }

  render() {
    if (this.state.error) return <ErrorScreen onRetry={() => this.setState({ error: null })} />
    return this.props.children
  }
}

/** The app-wide boundary: a route change clears the error, so the tab bar keeps working. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
}

export function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <main role="alert" className="pt-safe pb-safe mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-4xl font-extrabold tracking-tight text-brand">POMAK</p>
      <h1 className="text-xl font-semibold">{t('errors.screenTitle')}</h1>
      <p className="text-muted">{t('errors.screenText')}</p>
      <div className="flex w-full flex-col gap-2">
        <button type="button" className="app-button app-button-primary min-h-12 bg-brand px-5 text-white active:bg-brand-dark" onClick={onRetry}>
          {t('common.retry')}
        </button>
        {/* A full load also recovers from a stale or failed code chunk after an update. */}
        <button type="button" className="app-button min-h-12 px-5 text-brand-dark active:bg-brand-soft" onClick={() => window.location.assign('/')}>
          {t('errors.screenHome')}
        </button>
      </div>
    </main>
  )
}
