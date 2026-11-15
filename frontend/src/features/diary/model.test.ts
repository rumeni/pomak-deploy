import { describe, expect, it } from 'vitest'

import type { DiaryOpRow } from '../../lib/db'
import type { Food } from '../nutrition/api'
import { applyOps, copyEntry, entryFromFood, entryFromSavedItem, manualEntry, savedItemFromEntry, totals, withAmount } from './model'
import type { DiaryDay } from './types'

const egg: Food = {
  id: 'egg', name: 'Jaje (sirovo)', aliases: '', source: 'usda', source_ref: '171287', state: 'raw',
  kcal: '143.0', protein_g: '12.56', carbs_g: '0.72', fat_g: '9.51', fiber_g: '0.00', portions: [], is_custom: false,
}
const now = new Date('2026-09-30T08:00:00Z')
const DAY = '2026-09-30'

const op = (seq: number, rest: Partial<DiaryOpRow> & Pick<DiaryOpRow, 'type'>): DiaryOpRow =>
  ({ id: `op${seq}`, ownerId: 'u', date: DAY, seq, error: null, ...rest }) as DiaryOpRow

describe('stavke', () => {
  it('iz namirnice računa isto kao server (143 kcal/100 g × 50 g = 71,5)', () => {
    const { body, preview } = entryFromFood('e1', DAY, 'breakfast', egg, 50, '1 jaje (veliko)', now)
    expect(preview).toMatchObject({ kcal: '71.5', protein_g: '6.28', fat_g: '4.76', grams: '50.0', per100_kcal: '143.0' })
    expect(body).toMatchObject({ food_id: 'egg', grams: '50.0', name: '', kcal: null, portion_name: '1 jaje (veliko)' })
  })

  it('izmena količine koristi snimak stavke, ne trenutnu namirnicu (AC-04)', () => {
    const { preview } = entryFromFood('e1', DAY, 'breakfast', egg, 100, '', now)
    const changedFood = { ...preview, per100_kcal: '143.0' }
    expect(withAmount(changedFood, 200, '', 'lunch').preview).toMatchObject({ kcal: '286.0', meal: 'lunch' })
  })

  it('ručni unos: nepoznati makroi ostaju null (AC-05)', () => {
    const { body, preview } = manualEntry('m1', DAY, 'lunch', 'Burek', { kcal: '600', protein_g: null, carbs_g: null, fat_g: '35', fiber_g: null }, now)
    expect(preview).toMatchObject({ kcal: '600.0', protein_g: null, fat_g: '35.00', grams: null })
    expect(body).toMatchObject({ food_id: null, name: 'Burek', kcal: '600.0', protein_g: null, grams: null })
  })
})

describe('zaokruživanje kao na serveru', () => {
  it('pola se zaokružuje na paran broj, bez greške decimala u JavaScript-u', () => {
    const at = (fat: string, grams: number) => entryFromFood('x', DAY, 'lunch', { ...egg, fat_g: fat }, grams, '', now).preview.fat_g
    expect(at('9.51', 50)).toBe('4.76') // 4,755 -> 4,76
    expect(at('0.05', 50)).toBe('0.02') // 0,025 -> 0,02 (paran)
    expect(at('0.07', 50)).toBe('0.04') // 0,035 -> 0,04 (paran)
    expect(at('12.34', 33.3)).toBe('4.11') // 4,10922 -> 4,11
  })
})

describe('applyOps', () => {
  const server: DiaryDay = { date: DAY, status: null, entries: [entryFromFood('s1', DAY, 'breakfast', egg, 100, '', now).preview] }

  it('neposlate izmene se primenjuju redom preko stanja sa servera', () => {
    const add = entryFromFood('n1', DAY, 'lunch', egg, 50, '', now)
    const ops = [
      op(2, { type: 'delete', entryId: 's1' }),
      op(1, { type: 'upsert', entryId: 'n1', body: add.body, preview: add.preview }),
      op(3, { type: 'status', status: 'complete' }),
    ]
    const day = applyOps(DAY, server, ops)
    expect(day.entries.map((e) => e.id)).toEqual(['n1'])
    expect(day.status).toBe('complete')
    expect([...day.pendingIds].sort()).toEqual(['n1', 's1'])
    expect(day.statusPending).toBe(true)
  })

  it('odbijen unos ne ulazi u kcal zbir; korisnik vidi gresku', () => {
    const draft = entryFromFood('rejected', DAY, 'lunch', egg, 100, '', now)
    const rejected = op(1, { type: 'upsert', entryId: 'rejected', body: draft.body, preview: draft.preview, error: 'Bad quantity' })
    const day = applyOps(DAY, server, [rejected])
    expect(day.entries.map((e) => e.id)).toEqual(['s1'])
    expect(totals(day.entries).kcal).toBe(143)
    expect(day.errors.get('rejected')).toBe('Bad quantity')
  })

  it('radi i bez stanja sa servera, a premeštena stavka nestaje iz starog dana', () => {
    const moved = { ...server.entries[0], date: '2026-10-01' }
    const day = applyOps(DAY, server, [op(1, { type: 'upsert', entryId: 's1', body: {} as never, preview: moved })])
    expect(day.entries).toEqual([])
    expect(applyOps(DAY, null, []).entries).toEqual([])
  })
})

describe('totals', () => {
  it('nepoznate vrednosti se broje odvojeno, ne kao 0 (AC-05)', () => {
    const a = entryFromFood('a', DAY, 'breakfast', egg, 100, '', now).preview
    const b = manualEntry('b', DAY, 'lunch', 'Burek', { kcal: '600', protein_g: null, carbs_g: null, fat_g: '35', fiber_g: null }, now).preview
    expect(totals([a, b])).toEqual({
      kcal: 743,
      protein: { value: 12.6, unknown: 1 },
      carbs: { value: 0.7, unknown: 1 },
      fat: { value: 44.5, unknown: 0 },
    })
  })
})

describe('kopiranje i sačuvani obroci', () => {
  const eggEntry = entryFromFood('a', DAY, 'breakfast', egg, 100, '2 jaja', now).preview

  it('kopija ima novi ID, datum i obrok, a vrednosti iste', () => {
    const { body, preview } = copyEntry(eggEntry, 'b', '2026-10-01', 'lunch', now)
    expect(preview).toMatchObject({ id: 'b', date: '2026-10-01', meal: 'lunch', kcal: '143.0', portion_name: '2 jaja' })
    expect(body).toMatchObject({ food_id: 'egg', grams: '100.0' })
  })

  it('stavka čija je namirnica obrisana kopira se kao ručni unos', () => {
    const orphan = { ...eggEntry, food_id: null }
    const { body } = copyEntry(orphan, 'b', DAY, 'lunch', now)
    expect(body).toMatchObject({ food_id: null, grams: null, name: 'Jaje (sirovo)', kcal: '143.0' })
  })

  it('sačuvani obrok: namirnica daje vrednosti, ručna stavka svoje; tuđa/obrisana se preskače', () => {
    const food = entryFromSavedItem({ food: egg, grams: '50', portion_name: '1 jaje', name: '', kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null }, 'x', DAY, 'snack', now)
    expect(food?.preview).toMatchObject({ kcal: '71.5', meal: 'snack', portion_name: '1 jaje' })
    const manual = entryFromSavedItem({ food: null, grams: null, portion_name: '', name: 'Kafa', kcal: '40', protein_g: null, carbs_g: null, fat_g: '2', fiber_g: null }, 'y', DAY, 'snack', now)
    expect(manual?.preview).toMatchObject({ name: 'Kafa', kcal: '40.0', protein_g: null })
    expect(entryFromSavedItem({ food: null, grams: '50', portion_name: '', name: '', kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null }, 'z', DAY, 'snack', now)).toBeNull()
  })

  it('stavka dnevnika -> stavka sačuvanog obroka', () => {
    expect(savedItemFromEntry(eggEntry)).toEqual({ food_id: 'egg', grams: '100.0', portion_name: '2 jaja' })
    const burek = manualEntry('m', DAY, 'lunch', 'Burek', { kcal: '600', protein_g: null, carbs_g: null, fat_g: '35', fiber_g: null }, now).preview
    expect(savedItemFromEntry(burek)).toEqual({ name: 'Burek', kcal: '600.0', protein_g: null, carbs_g: null, fat_g: '35.00', fiber_g: null })
  })
})
