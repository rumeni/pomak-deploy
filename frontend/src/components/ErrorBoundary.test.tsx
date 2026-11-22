// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { ErrorBoundary } from './ErrorBoundary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let shouldThrow = true
function Screen() {
  if (shouldThrow) throw new Error('broken screen')
  return <p>screen-ok</p>
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  shouldThrow = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const render = (resetKey: string, onError?: () => void) =>
  act(() => root.render(<ErrorBoundary resetKey={resetKey} onError={onError}><Screen /></ErrorBoundary>))

describe('ErrorBoundary', () => {
  it('shows a recovery screen instead of a blank app and reports the error', () => {
    const onError = vi.fn()
    render('/napredak', onError)
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.textContent).toContain('errors.screenTitle')
    expect(onError).toHaveBeenCalledOnce()
  })

  it('renders the screen again after "Try again" once the cause is gone', () => {
    render('/napredak')
    shouldThrow = false
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'common.retry')!
    act(() => retry.click())
    expect(container.textContent).toContain('screen-ok')
  })

  it('clears the error when the route changes', () => {
    render('/napredak')
    shouldThrow = false
    render('/danas')
    expect(container.textContent).toContain('screen-ok')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
