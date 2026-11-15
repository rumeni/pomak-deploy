import { describe, expect, it } from 'vitest'

import { restNotificationAction } from './restNotification'

const now = new Date('2026-09-25T10:00:00Z')
const at = (s: number) => new Date(now.getTime() + s * 1000).toISOString()

describe('restNotificationAction', () => {
  it('nova pauza: zakaži', () => {
    expect(restNotificationAction(null, at(90), now)).toEqual({ cancel: false, schedule: at(90) })
  })

  it('pomerena pauza (−15 s): zakaži novo vreme', () => {
    expect(restNotificationAction(at(90), at(75), now)).toEqual({ cancel: false, schedule: at(75) })
  })

  it('isto vreme posle ponovnog iscrtavanja: ništa', () => {
    expect(restNotificationAction(at(90), at(90), now)).toEqual({ cancel: false, schedule: null })
  })

  it('Preskoči pre kraja: otkaži', () => {
    expect(restNotificationAction(at(30), null, now)).toEqual({ cancel: true, schedule: null })
  })

  it('pauza istekla sama: obaveštenje ostaje', () => {
    expect(restNotificationAction(at(-1), null, now)).toEqual({ cancel: false, schedule: null })
  })

  it('skraćena ispod nule: otkaži (tajmer je već gotov na ekranu)', () => {
    expect(restNotificationAction(at(30), at(-5), now)).toEqual({ cancel: true, schedule: null })
  })
})
