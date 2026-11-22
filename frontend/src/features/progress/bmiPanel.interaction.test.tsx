// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Me } from '../../lib/types'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../lib/api', () => ({ errorMessage: (e: unknown) => `failed: ${(e as Error).message}`, scopeIsCurrent: () => true }))
// Only the network call is replaced; scope checks and the cache merge are the real ones.
vi.mock('../../lib/profileMutation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/profileMutation')>()),
  patchOwnProfile: vi.fn(),
}))

const { BmiPanel } = await import('./BmiPanel')
const { patchOwnProfile } = await import('../../lib/profileMutation')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const me = (show: boolean): Me => ({
  id: 'u1', email: 'u1@example.com',
  profile: {
    display_name: '', language: 'sr-latn', is_coach: false, tracks_training: true, tracks_nutrition: true,
    onboarding_completed_at: '2026-11-01T00:00:00Z', training_experience: '', weekly_workouts_target: null,
    sex: '', birth_date: '1990-01-01', height_cm: '181.0', meals: null, show_bmi_category: show,
  },
})

/** Renders the panel from the cached account, as the Progress screen does. */
function Screen() {
  const { data } = useQuery<Me>({ queryKey: ['me'], queryFn: () => me(false), staleTime: Infinity })
  if (!data) return null
  return <BmiPanel bmi={{ value: 25.2, category: 'overweight' }} ownerId={data.id} showCategory={data.profile.show_bmi_category === true} />
}

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient

beforeEach(() => {
  vi.mocked(patchOwnProfile).mockReset()
  queryClient = new QueryClient()
  queryClient.setQueryData(['me'], me(false))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<QueryClientProvider client={queryClient}><Screen /></QueryClientProvider>))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const button = () => container.querySelector('button[aria-pressed]') as HTMLButtonElement

describe('turning the BMI category on', () => {
  it('saves the choice on the account and shows the category', async () => {
    vi.mocked(patchOwnProfile).mockResolvedValue(me(true))
    expect(container.textContent).not.toContain('progress.bmiCategory_overweight')
    await act(async () => button().click())
    expect(patchOwnProfile).toHaveBeenCalledWith('u1', { show_bmi_category: true }, expect.anything())
    expect(queryClient.getQueryData<Me>(['me'])?.profile.show_bmi_category).toBe(true)
    // The query cache notifies screens on its next tick.
    await act(() => vi.waitFor(() => expect(container.textContent).toContain('progress.bmiCategory_overweight')))
    expect(button().getAttribute('aria-pressed')).toBe('true')
    expect(button().textContent).toBe('progress.bmiHideCategory')
  })

  it('keeps the category hidden and shows the error when saving fails', async () => {
    vi.mocked(patchOwnProfile).mockRejectedValue(new Error('offline'))
    await act(async () => button().click())
    expect(container.textContent).toContain('failed: offline')
    expect(container.textContent).not.toContain('progress.bmiCategory_overweight')
    expect(queryClient.getQueryData<Me>(['me'])?.profile.show_bmi_category).toBe(false)
    expect(button().disabled).toBe(false)
  })
})
