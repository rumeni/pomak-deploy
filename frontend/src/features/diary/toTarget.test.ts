import { describe, expect, it } from 'vitest'

import type { Food } from '../nutrition/api'
import type { DayTotals } from './model'
import { focusMacro, remainingToTarget, suggestFoods } from './toTarget'
import type { DayTarget } from './types'

const target: DayTarget = { valid_from: '2026-11-23', mode: 'manual', kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 70 }
const totals = (kcal: number, protein: number, carbs: number, fat: number, unknown = 0): DayTotals => ({
  kcal, protein: { value: protein, unknown }, carbs: { value: carbs, unknown: 0 }, fat: { value: fat, unknown: 0 },
})
const food = (id: string, kcal: string, protein: string | null, portion?: [string, string]): Food => ({
  id, name: id, aliases: '', source: 'usda', source_ref: '', state: 'na', kcal, protein_g: protein, carbs_g: '1', fat_g: '1',
  fiber_g: null, portions: portion ? [{ name: portion[0], grams: portion[1] }] : [], is_custom: false,
})

describe('what is left to the daily target', () => {
  it('subtracts known totals; a macro without a goal has no remainder', () => {
    const rem = remainingToTarget(totals(1180, 105, 110, 50), { ...target, fat_g: null })
    expect(rem).toEqual({ kcal: 820, protein: 45, carbs: 90, fat: null })
  })

  it('goes negative over the target instead of hiding it', () => {
    expect(remainingToTarget(totals(2150, 160, 210, 80), target).kcal).toBe(-150)
  })

  it('puts protein first while a quarter of it is missing, even if fat is further behind', () => {
    // Protein 146 of 165 g missing (89 %), fat 64 of 70 g (91 %): suggest protein, not fat.
    expect(focusMacro(remainingToTarget(totals(735, 18.6, 152, 6.3), { ...target, protein_g: 165, carbs_g: 230 }),
      { ...target, protein_g: 165, carbs_g: 230 })).toBe('protein')
    expect(focusMacro(remainingToTarget(totals(1000, 50, 180, 60), target), target)).toBe('protein')
  })

  it('otherwise focuses on the macro furthest from its goal, never one that is nearly met', () => {
    expect(focusMacro(remainingToTarget(totals(1000, 140, 60, 65), target), target)).toBe('carbs')
    expect(focusMacro(remainingToTarget(totals(1000, 120, 190, 20), target), target)).toBe('fat')
    expect(focusMacro(remainingToTarget(totals(1900, 145, 195, 68), target), target)).toBeNull()
    expect(focusMacro(remainingToTarget(totals(1000, 0, 0, 0), { ...target, protein_g: null, carbs_g: null, fat_g: null }),
      { ...target, protein_g: null, carbs_g: null, fat_g: null })).toBeNull()
  })
})

describe('suggestions from the user\'s own foods', () => {
  const rem = { kcal: 300, protein: 45, carbs: 20, fat: 5 }

  it('suggests the best protein sources that fit in the calories left, one usual portion each', () => {
    const ideas = suggestFoods([
      food('rice', '130', '2.7'),
      food('chicken', '165', '31', ['1 file', '120']),
      food('egg', '143', '12.6', ['1 jaje', '50']),
      food('nuts', '600', '20'),
    ], rem, 'protein')
    expect(ideas.map((i) => i.food.id)).toEqual(['chicken', 'egg', 'rice'])
    expect(ideas[0]).toMatchObject({ grams: 120, portionName: '1 file', kcal: 198, macroGrams: 37.2 })
    // 100 g of nuts (600 kcal) does not fit in 300 kcal.
    expect(ideas.some((i) => i.food.id === 'nuts')).toBe(false)
  })

  it('never treats an unknown value as 0 and skips duplicates', () => {
    const ideas = suggestFoods([food('label', '100', null), food('egg', '143', '12.6'), food('egg', '143', '12.6')], rem, 'protein')
    expect(ideas.map((i) => i.food.id)).toEqual(['egg'])
  })

  it('without a focus macro keeps the user\'s order of recent foods', () => {
    const ideas = suggestFoods([food('b', '50', null), food('a', '80', '3')], rem, null)
    expect(ideas.map((i) => i.food.id)).toEqual(['b', 'a'])
    expect(ideas[0].macroGrams).toBeNull()
  })

  it('suggests nothing once the calories are used up', () => {
    expect(suggestFoods([food('egg', '143', '12.6')], { ...rem, kcal: 0 }, 'protein')).toEqual([])
  })
})
