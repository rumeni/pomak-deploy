import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../lib/api', () => ({ errorMessage: (e: unknown) => String(e) }))
vi.mock('../../lib/profileMutation', () => ({
  applyOwnProfileResponse: vi.fn(), patchOwnProfile: vi.fn(), profileScope: vi.fn(),
}))

import { BmiPanel } from './BmiPanel'

const render = (showCategory: boolean) => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <BmiPanel bmi={{ value: 25.2, category: 'overweight' }} ownerId="u1" showCategory={showCategory} />
  </QueryClientProvider>,
)

describe('BMI panel', () => {
  it('shows only the number until the category is turned on', () => {
    const html = render(false)
    expect(html).toContain('progress.bmiLabel')
    expect(html).toContain('25,2')
    expect(html).not.toContain('progress.bmiCategory_overweight')
    expect(html).toContain('progress.bmiShowCategory')
    expect(html).toContain('aria-pressed="false"')
  })

  it('shows the category after opting in, with a way to hide it again', () => {
    const html = render(true)
    expect(html).toContain('progress.bmiCategory_overweight')
    expect(html).toContain('progress.bmiHideCategory')
    expect(html).toContain('aria-pressed="true"')
  })
})
