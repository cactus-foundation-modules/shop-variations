import { describe, it, expect } from 'vitest'
import { availableWith, availableWithSentence } from '@/modules/shop-variations/lib/selection-logic'
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'

// Width then Storage, the shape this exists for: a pedestal the narrow desks
// cannot take, so picking 140cm puts it out of reach and the shopper has to be
// told which widths do carry it.
function mkPayload(pedestalWidths: string[]): VariantSelectorPayload {
  const v = (id: string, ids: string[]) => ({ id, childProductId: id, optionValueIds: ids, enabled: true, inStock: true, price: 10, compareAtPrice: null, imageUrls: [] })
  const widths = ['W140', 'W160', 'W170', 'W180']
  return {
    productId: 'p', basePrice: 5, baseImages: [], addons: [],
    options: [
      { id: 'W', name: 'Width', controlType: 'PILL', requiresPreviousOption: false, values: widths.map((id) => ({ id, label: `${id.slice(1)}cm`, swatch: null })) },
      { id: 'S', name: 'Storage', controlType: 'PILL', requiresPreviousOption: false, values: [ { id: 'S0', label: 'No pedestal', swatch: null }, { id: 'S1', label: '2 + 3 Drawer Fixed Pedestals', swatch: null } ] },
    ],
    variants: [
      ...widths.map((w) => v(`${w}-S0`, [w, 'S0'])),
      ...pedestalWidths.map((w) => v(`${w}-S1`, [w, 'S1'])),
    ],
  } as unknown as VariantSelectorPayload
}

describe('availableWith', () => {
  it('names the widths that carry a choice the current width cannot', () => {
    const groups = availableWith(mkPayload(['W160', 'W170', 'W180']), { W: 'W140' }, 'S', 'S1')
    expect(groups).toEqual([{ optionId: 'W', optionName: 'Width', labels: ['160cm', '170cm', '180cm'], contiguous: true }])
  })

  it('flags a gappy set as not contiguous', () => {
    const groups = availableWith(mkPayload(['W160', 'W180']), { W: 'W140' }, 'S', 'S1')
    expect(groups[0]?.labels).toEqual(['160cm', '180cm'])
    expect(groups[0]?.contiguous).toBe(false)
  })

  it('says nothing where the value is reachable as things stand', () => {
    expect(availableWith(mkPayload(['W140', 'W160']), { W: 'W140' }, 'S', 'S1')).toEqual([])
  })

  it('says nothing before the shopper has picked anything', () => {
    expect(availableWith(mkPayload(['W160']), {}, 'S', 'S1')).toEqual([])
  })

  it('says nothing for a value nothing buyable carries at all', () => {
    // No pedestal variant exists, so no width would bring it back and there is
    // no honest "available in" to print.
    expect(availableWith(mkPayload([]), { W: 'W140' }, 'S', 'S1')).toEqual([])
  })

  it('ignores an out-of-stock width when naming where a choice is to be had', () => {
    const payload = mkPayload(['W160', 'W170', 'W180'])
    const dead = payload.variants.find((x) => x.id === 'W160-S1')
    if (dead) dead.inStock = false
    const groups = availableWith(payload, { W: 'W140' }, 'S', 'S1')
    expect(groups[0]?.labels).toEqual(['170cm', '180cm'])
  })
})

describe('availableWithSentence', () => {
  it('collapses an unbroken run of three or more, saying the unit once', () => {
    expect(availableWithSentence([{ optionId: 'W', optionName: 'Width', labels: ['160cm', '170cm', '180cm'], contiguous: true }])).toBe('160 to 180cm')
  })

  it('lists a gappy set in full rather than promising a width that is not on offer', () => {
    expect(availableWithSentence([{ optionId: 'W', optionName: 'Width', labels: ['160cm', '180cm'], contiguous: false }])).toBe('160cm or 180cm')
  })

  it('lists three gappy values with commas and a final or', () => {
    expect(availableWithSentence([{ optionId: 'W', optionName: 'Width', labels: ['140cm', '160cm', '180cm'], contiguous: false }])).toBe('140cm, 160cm or 180cm')
  })

  it('lists words out rather than making a range of them', () => {
    expect(availableWithSentence([{ optionId: 'F', optionName: 'Finish', labels: ['Oak', 'Ash', 'Walnut'], contiguous: true }])).toBe('Oak, Ash or Walnut')
  })

  it('collapses bare numbers with no unit too', () => {
    expect(availableWithSentence([{ optionId: 'D', optionName: 'Drawers', labels: ['2', '3', '4'], contiguous: true }])).toBe('2 to 4')
  })

  it('reads a single value straight out', () => {
    expect(availableWithSentence([{ optionId: 'W', optionName: 'Width', labels: ['180cm'], contiguous: true }])).toBe('180cm')
  })

  it('joins two culprit options with and', () => {
    expect(availableWithSentence([
      { optionId: 'W', optionName: 'Width', labels: ['180cm'], contiguous: true },
      { optionId: 'F', optionName: 'Finish', labels: ['Oak'], contiguous: true },
    ])).toBe('180cm and Oak')
  })

  it('is empty for nothing to say', () => {
    expect(availableWithSentence([])).toBe('')
  })
})
