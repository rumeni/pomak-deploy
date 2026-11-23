// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({
  api: {
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}))

const { useConnectCoach, useDisconnectCoach, useUpdateCoachSharing } = await import('./api')
const { refreshCoachLists } = await import('./access')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PLAN = ['my-meal-plan', 'sr-Latn']
let qc: QueryClient
let container: HTMLDivElement
let root: Root
type Mutations = { connect: ReturnType<typeof useConnectCoach>; share: ReturnType<typeof useUpdateCoachSharing>; disconnect: ReturnType<typeof useDisconnectCoach> }
const probe: { current?: Mutations } = {}

function Probe({ onReady }: { onReady: (m: Mutations) => void }) {
  const m = { connect: useConnectCoach(), share: useUpdateCoachSharing(), disconnect: useDisconnectCoach() }
  useEffect(() => onReady(m))
  return null
}

beforeEach(() => {
  qc = new QueryClient()
  qc.setQueryData(PLAN, { coach_name: 'Nina', updated_at: 'x', items: [{ meal: 'lunch' }] })
  container = document.createElement('div')
  root = createRoot(container)
  act(() => root.render(<QueryClientProvider client={qc}><Probe onReady={(m) => { probe.current = m }} /></QueryClientProvider>))
})

afterEach(() => act(() => root.unmount()))

describe('the client\'s cached meal plan follows the collaboration and its consent', () => {
  it.each([
    ['changing consent', () => probe.current!.share.mutateAsync({ share_measurements: false, share_nutrition: false } as never)],
    ['ending the collaboration', () => probe.current!.disconnect.mutateAsync(undefined)],
    ['connecting to a (new) coach', () => probe.current!.connect.mutateAsync({ code: 'ABC' } as never)],
  ])('%s forgets the old plan at once', async (_name, run) => {
    await act(async () => { await run() })
    expect(qc.getQueryData(PLAN)).toBeUndefined()
  })
})

describe('the coach\'s meal plan panel after an access change', () => {
  it('is reloaded together with the client\'s other data', async () => {
    const spy = vi.spyOn(qc, 'invalidateQueries')
    await refreshCoachLists(qc, 'ana')
    expect(spy).toHaveBeenCalledWith({ queryKey: ['coach-client-meal-plan', 'ana'] })
  })
})
