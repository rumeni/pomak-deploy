import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('./api', () => ({
  usePerformedExercises: () => ({ data: [], isLoading: false, isError: false }),
  useMeasurements: () => ({ data: [], isLoading: false, isError: false }),
}))
vi.mock('./GoalsSection', () => ({ GoalsSection: () => <div>goals-list</div> }))
vi.mock('./WeekCard', () => ({ WeekCard: () => <div>week-view</div> }))
vi.mock('../../components/LanguageMenu', () => ({ LanguageMenu: () => null }))
vi.mock('../training/ExerciseImage', () => ({ ExerciseThumb: () => null }))
vi.mock('../../components/LineChart', () => ({ LineChart: () => null }))

import { ProgressPage } from './ProgressPage'

describe('goal conflict notice on the progress list', () => {
  it('shows a visible alert about edits not being saved after a 409 redirect', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[{ pathname: '/napredak', state: { goalConflictNotice: true } }]}>
        <ProgressPage />
      </MemoryRouter>,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('progress.goalConflictNotice')
    expect(html).toContain('goals-list')
  })

  it('does not replay a consumed conflict notice after location state has been cleared', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[{ pathname: '/napredak', state: null }]}>
        <ProgressPage />
      </MemoryRouter>,
    )
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('progress.goalConflictNotice')
  })

  it('does not show the conflict alert on a normal visit', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/napredak']}>
        <ProgressPage />
      </MemoryRouter>,
    )
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('progress.goalConflictNotice')
  })
})
