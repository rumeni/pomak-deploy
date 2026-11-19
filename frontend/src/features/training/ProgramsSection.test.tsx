// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Routine, RoutinePayload } from './api'
import type { Program } from './programs'

// A tiny fake server: routines are created by POST, a chosen POST fails once.
const server = vi.hoisted(() => ({
  routines: [] as Routine[],
  posts: 0,
  failPost: 0, // which POST (1-based) answers with an error
}))

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      if (url === '/training/programs/') return { data: [PROGRAM] }
      if (url === '/training/routines/') return { data: server.routines.map((r) => ({ ...r })) }
      throw new Error(`unexpected GET ${url}`)
    }),
    post: vi.fn(async (_url: string, body: RoutinePayload) => {
      server.posts += 1
      if (server.posts === server.failPost) throw new Error('network')
      if (server.routines.some((r) => r.id === body.id)) {
        throw Object.assign(new Error('exists'), { isAxiosError: true, response: { status: 412 } })
      }
      server.routines.push({ id: body.id!, name: body.name, notes: body.notes ?? '', program_key: body.program_key, exercises: [], created_at: '', updated_at: '' })
      return { data: {} }
    }),
  },
  errorMessage: () => 'Neuspelo.',
  scopeIsCurrent: () => true,
}))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ me: { id: 'u1' } }) }))
vi.mock('../../lib/tokens', () => ({ tokens: { session: () => 's1' } }))
vi.mock('../../i18n', () => ({ default: { language: 'sr' } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const PROGRAM: Program = vi.hoisted(() => ({
  key: 'split-3',
  sex: 'male',
  level: 'intermediate',
  days: 3,
  name: 'A · B · C',
  description: 'Three days.',
  recommended: true,
  routines: [
    { name: 'A', exercises: [] },
    { name: 'B', exercises: [] },
    { name: 'C', exercises: [] },
  ],
}))

const { ProgramsSection } = await import('./ProgramsSection')
const { api } = await import('../../lib/api')

/** Like the training screen: routines come from the server and are refetched after an import. */
function Screen() {
  const { data } = useQuery({ queryKey: ['routines'], queryFn: async () => (await api.get<Routine[]>('/training/routines/')).data })
  return <ProgramsSection routines={data} />
}

let root: Root
let host: HTMLDivElement

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
  }
}

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  server.routines = []
  server.posts = 0
  server.failPost = 0
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>)
  })
  await settle()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('a first program import that fails halfway', () => {
  it('keeps the card, its error and retry visible, then resumes without duplicates', async () => {
    // No routines: the suggestions are open.
    expect(host.querySelector('#programs-list')?.className).not.toBe('hidden')
    server.failPost = 2 // the first routine is created, the second POST fails

    await act(async () => { button('programs.add')!.click() })
    await settle()

    // The refetch now has one routine, but the list stays open with the card's error and retry.
    expect(server.routines).toHaveLength(1)
    expect(host.querySelector('#programs-list')?.className).not.toBe('hidden')
    expect(host.querySelector('[role=alert]')?.textContent).toBe('Neuspelo.')
    expect(button('programs.retry')).toBeTruthy()
    // Partly imported is not "already in your routines".
    expect(host.textContent).not.toContain('programs.inYourRoutines')

    await act(async () => { button('programs.retry')!.click() })
    await settle()

    expect(server.routines.map((r) => r.name)).toEqual(['A', 'B', 'C'])
    expect(new Set(server.routines.map((r) => r.id)).size).toBe(3)
    expect(host.textContent).toContain('programs.added')
    expect(host.querySelector('[role=alert]')).toBeNull()
  })

  it('collapsing the section keeps the card state; opening it shows the same retry', async () => {
    server.failPost = 2
    await act(async () => { button('programs.add')!.click() })
    await settle()
    expect(button('programs.retry')).toBeTruthy()

    const toggle = host.querySelector<HTMLButtonElement>('#programs-title button')!
    await act(async () => { toggle.click() })
    expect(host.querySelector('#programs-list')?.className).toBe('hidden')
    await act(async () => { toggle.click() })
    expect(host.querySelector('#programs-list')?.className).not.toBe('hidden')
    expect(button('programs.retry')).toBeTruthy()
  })
})

describe('with routines already there', () => {
  it('a finished program is marked as in your routines and the section starts collapsed', async () => {
    act(() => root.unmount())
    server.routines = PROGRAM.routines.map((r, i) => ({ id: `r${i}`, name: r.name, notes: PROGRAM.name, program_key: PROGRAM.key, exercises: [], created_at: '', updated_at: '' }))
    root = createRoot(host)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await act(async () => {
      root.render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>)
    })
    await settle()
    expect(host.querySelector('#programs-list')?.className).toBe('hidden')
    expect(host.textContent).toContain('programs.inYourRoutines')
  })
})
