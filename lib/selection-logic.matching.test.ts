import { describe, it, expect } from 'vitest'
import { matchingVariants } from '@/modules/shop-variations/lib/selection-logic'
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'

// Two options, the shape that broke the Oslo Air Piste desk: Width x Modesty
// Panel, every combination present, every one of them carrying its own picture
// and nothing on the parent.
function mkPayload(): VariantSelectorPayload {
  const v = (id: string, ids: string[], enabled = true) => ({
    id, childProductId: `c-${id}`, optionValueIds: ids, enabled, inStock: true,
    price: 10, compareAtPrice: null, imageUrls: [`${id}.jpg`],
  })
  return {
    productId: 'p', basePrice: 5, baseImages: [], addons: [],
    options: [
      { id: 'W', name: 'Width', controlType: 'PILL', requiresPreviousOption: false, values: [
        { id: 'W120', label: '120cm', swatch: null }, { id: 'W140', label: '140cm', swatch: null }, { id: 'W160', label: '160cm', swatch: null },
      ] },
      { id: 'M', name: 'Modesty Panel', controlType: 'PILL', requiresPreviousOption: false, values: [
        { id: 'MWith', label: 'With Modesty Panel', swatch: null }, { id: 'MWithout', label: 'Without Modesty Panel', swatch: null },
      ] },
    ],
    variants: [
      v('v1', ['W120', 'MWithout']),
      v('v2', ['W120', 'MWith']),
      v('v3', ['W140', 'MWithout']),
      v('v4', ['W140', 'MWith']),
      v('v5', ['W160', 'MWithout']),
      v('v6', ['W160', 'MWith'], false),
    ],
  } as unknown as VariantSelectorPayload
}

const ids = (payload: VariantSelectorPayload, selection: Record<string, string>) =>
  matchingVariants(payload, selection).map((v) => v.id)

describe('matchingVariants', () => {
  it('an untouched selection matches every switched-on variation', () => {
    expect(ids(mkPayload(), {})).toEqual(['v1', 'v2', 'v3', 'v4', 'v5'])
  })

  it('one pick narrows to the variations carrying it - the case that emptied the gallery', () => {
    expect(ids(mkPayload(), { W: 'W160' })).toEqual(['v5'])
    expect(ids(mkPayload(), { M: 'MWith' })).toEqual(['v2', 'v4'])
  })

  it('narrows on a LOWER option too, unlike the directional availability filter', () => {
    // isValueAvailable deliberately ignores picks below the option it is asked
    // about; this must not, or a shopper who picked the panel first would still
    // be shown every width.
    expect(ids(mkPayload(), { M: 'MWithout' })).toEqual(['v1', 'v3', 'v5'])
  })

  it('a full selection matches the single combination it resolves to', () => {
    expect(ids(mkPayload(), { W: 'W140', M: 'MWith' })).toEqual(['v4'])
  })

  it('a switched-off variation never matches, chosen or not', () => {
    expect(ids(mkPayload(), { W: 'W160', M: 'MWith' })).toEqual([])
  })

  it('a combination nothing carries matches nothing', () => {
    const payload = mkPayload()
    payload.variants = payload.variants.filter((v) => v.id !== 'v4')
    expect(ids(payload, { W: 'W140', M: 'MWith' })).toEqual([])
  })

  it('an alias narrows exactly as the value it stands in for', () => {
    const payload = mkPayload()
    // v3 answers to "With Modesty Panel" as well as its own value.
    const v3 = payload.variants.find((v) => v.id === 'v3')
    if (v3) (v3 as { aliasValueIds?: string[] }).aliasValueIds = ['MWith']
    expect(ids(payload, { M: 'MWith' })).toEqual(['v2', 'v3', 'v4'])
  })
})
