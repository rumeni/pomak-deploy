import { describe, expect, it } from 'vitest'

import { parseLabelText } from './labelText'

describe('reading a nutrition table from OCR text', () => {
  it('reads a Serbian table, per 100 g column first, skipping "of which" rows', () => {
    const text = `Nutritivna vrednost   na 100 g   na porciju 200 g
Energetska vrednost 255 kJ / 61 kcal  510 kJ / 122 kcal
Masti 2,8 g 5,6 g
od kojih zasićene masne kiseline 1,8 g 3,6 g
Ugljeni hidrati 4,6 g 9,2 g
od kojih šećeri 4,6 g 9,2 g
Vlakna 0 g
Proteini 3,2 g 6,4 g
So 0,1 g 0,2 g`
    expect(parseLabelText(text)).toEqual({
      values: { kcal: '61', fat_g: '2.8', carbs_g: '4.6', fiber_g: '0', protein_g: '3.2' },
      found: ['kcal', 'fat_g', 'carbs_g', 'fiber_g', 'protein_g'],
    })
  })

  it('handles multilingual labels, energy wrapped to the next line and kJ only', () => {
    const text = `Energija / Energy
1520 kJ
Masti/Fat 12 g
od toga zasićene/of which saturates 4,1 g
Ugljikohidrati/Carbohydrate 52,3 g
of which sugars 30 g
Bjelančevine/Protein 6,5 g`
    const { values } = parseLabelText(text)
    expect(values).toEqual({ kcal: '363', fat_g: '12', carbs_g: '52.3', protein_g: '6.5' })
  })

  it('leaves out what it cannot read instead of guessing', () => {
    expect(parseLabelText('Sastojci: mleko, kultura\nČuvati na hladnom')).toEqual({ values: {}, found: [] })
    // A value over 100 g per 100 g is an OCR slip (e.g. "28" read as "280").
    expect(parseLabelText('Proteini 280 g').values.protein_g).toBeUndefined()
    expect(parseLabelText('Energija 9000 kcal').values.kcal).toBeUndefined()
  })
})

describe('common OCR slips', () => {
  it('reads "keal", spaced decimals and a letter O for zero', () => {
    const text = 'Energija 255 kJ / 61 keal\nMasti 2 , 8g\nVlakna O,5 g\nProteini 3.2q'
    expect(parseLabelText(text).values).toEqual({ kcal: '61', fat_g: '2.8', fiber_g: '0.5', protein_g: '3.2' })
  })
})

describe('what the recogniser actually returned for a real table', () => {
  it('takes the per-100 g energy even without its kcal and drops a g read as 9', () => {
    const text = `na porciju (200
Nutritivna vrednost                  na 100 g               g)
Energetska vrednost               O kJ/61 | 540 KJ / 122 kcal
Masti                                     2,8g                5,6g
od kojih zasićene masne
kiseline                                  189                369
Ugljeni hidrati                       4,69g              9,2g
od kojih šećeri                      4,69g              9,2g
Proteini                                3,2g               6,4g`
    expect(parseLabelText(text).values).toEqual({ kcal: '61', fat_g: '2.8', carbs_g: '4.6', protein_g: '3.2' })
  })
})

