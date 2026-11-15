import { describe, expect, it } from 'vitest'

import { splitInstructions } from './instructions'

describe('splitInstructions', () => {
  it('koraci red po red, savet izdvojen', () => {
    expect(splitInstructions('Lezi na klupu.\nSpusti šipku.\nSavet: koristi obezbeđenje.')).toEqual({
      steps: ['Lezi na klupu.', 'Spusti šipku.'],
      tip: 'Savet: koristi obezbeđenje.',
    })
  })

  it('lična vežba: slobodan tekst bez saveta, prazni redovi se preskaču', () => {
    expect(splitInstructions('Moje beleške\n\nsa praznim redom')).toEqual({ steps: ['Moje beleške', 'sa praznim redom'], tip: null })
    expect(splitInstructions('')).toEqual({ steps: [], tip: null })
  })
})
