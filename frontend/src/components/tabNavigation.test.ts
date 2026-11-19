import { describe, expect, it } from 'vitest'
import { CLIENT_TABS, COACH_PERSONAL_TABS, COACH_SPACE_TABS, swipeDestination, tabIndex, tabRoutes } from './tabNavigation'

describe('main tab navigation', () => {
  it('keeps client tabs and coach spaces separate', () => {
    expect(tabRoutes('/danas', false)).toBe(CLIENT_TABS)
    expect(tabRoutes('/danas', true)).toBe(COACH_PERSONAL_TABS)
    expect(tabRoutes('/trener/poruke', true)).toBe(COACH_SPACE_TABS)
    expect(tabIndex('/trener/poruke/123', COACH_SPACE_TABS)).toBe(4)
  })

  it('switches to adjacent main tabs on a decisive horizontal swipe', () => {
    expect(swipeDestination('/trening', CLIENT_TABS, -110, 13, 250, 160, 390)).toBe('/ishrana')
    expect(swipeDestination('/trening', CLIENT_TABS, 108, -10, 250, 160, 390)).toBe('/danas')
    expect(swipeDestination('/danas', CLIENT_TABS, 108, 0, 250, 160, 390)).toBeNull()
    expect(swipeDestination('/napredak', COACH_PERSONAL_TABS, -110, 0, 200, 190, 390)).toBeNull()
  })

  it('does not steal vertical, short, slow, native-edge or subpage gestures', () => {
    expect(swipeDestination('/trening', CLIENT_TABS, 17, 130, 200, 120, 390)).toBeNull()
    expect(swipeDestination('/trening', CLIENT_TABS, -110, 108, 200, 120, 390)).toBeNull()
    expect(swipeDestination('/trening', CLIENT_TABS, -60, 10, 200, 120, 390)).toBeNull()
    expect(swipeDestination('/trening', CLIENT_TABS, -120, 5, 1050, 120, 390)).toBeNull()
    expect(swipeDestination('/trening', CLIENT_TABS, -120, 5, 200, 8, 390)).toBeNull()
    expect(swipeDestination('/trening/rutine/nova', CLIENT_TABS, -140, 3, 200, 120, 390)).toBeNull()
  })
})
