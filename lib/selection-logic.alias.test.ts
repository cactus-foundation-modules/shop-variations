import { describe, it, expect } from 'vitest'
import { resolveVariant, isValueAvailable, variantAnswersTo, valueToOptionMap } from '@/modules/shop-variations/lib/selection-logic'
import type { VariantSelectorPayload, VariantSelectorVariant } from '@/modules/shop-variations/lib/types'

// The shape this exists for: a chair with a Back style (Black Back / Matching
// Back) and an Upholstery Colour. For every colour but black the two back styles
// are different chairs with different SKUs. For black they are the SAME chair -
// its back is black AND matches its black seat - so one variation has to answer
// to both, or whichever wording the shopper did not pick greys black out.
const BACK_BLACK = 'B-black'
const BACK_MATCH = 'B-matching'

function mkPayload(aliases: Record<string, string[]> = {}): VariantSelectorPayload {
  const v = (id: string, ids: string[]): VariantSelectorVariant => ({
    id,
    childProductId: id,
    optionValueIds: ids,
    aliasValueIds: aliases[id] ?? [],
    enabled: true,
    inStock: true,
    price: 10,
    compareAtPrice: null,
    stockCount: null,
    imageUrls: [],
    sku: id,
    supplier: null,
  })
  return {
    productId: 'p',
    basePrice: 5,
    baseImages: [],
    addons: [],
    options: [
      {
        id: 'B', name: 'Back', controlType: 'PILL', requiresPreviousOption: false,
        values: [{ id: BACK_BLACK, label: 'Black Back', swatch: null }, { id: BACK_MATCH, label: 'Matching Back', swatch: null }],
      },
      {
        id: 'C', name: 'Upholstery Colour', controlType: 'IMAGE', requiresPreviousOption: false,
        values: [{ id: 'C-black', label: 'Black Fabric', swatch: null }, { id: 'C-crab', label: 'Quest Crab', swatch: null }],
      },
    ],
    variants: [
      // The all-black chair. Filed under Black Back, aliased to Matching Back.
      v('all-black', [BACK_BLACK, 'C-black']),
      // A crab seat with a black back, and a crab seat with a crab back: two real,
      // different chairs, both wordings carrying one of their own.
      v('crab-black-back', [BACK_BLACK, 'C-crab']),
      v('crab-matching', [BACK_MATCH, 'C-crab']),
    ],
  } as unknown as VariantSelectorPayload
}

const WITH_ALIAS = { 'all-black': [BACK_MATCH] }

describe('variantAnswersTo', () => {
  it('answers to the value it carries', () => {
    const payload = mkPayload(WITH_ALIAS)
    const v2o = valueToOptionMap(payload)
    const allBlack = payload.variants[0]!
    expect(variantAnswersTo(allBlack, 'B', BACK_BLACK, v2o)).toBe(true)
  })

  it('answers to a value it only stands in for', () => {
    const payload = mkPayload(WITH_ALIAS)
    const v2o = valueToOptionMap(payload)
    expect(variantAnswersTo(payload.variants[0]!, 'B', BACK_MATCH, v2o)).toBe(true)
  })

  it('does not answer to a value it neither carries nor stands in for', () => {
    const payload = mkPayload()
    const v2o = valueToOptionMap(payload)
    expect(variantAnswersTo(payload.variants[0]!, 'B', BACK_MATCH, v2o)).toBe(false)
  })

  it('reads a payload serialised before aliases existed as having none', () => {
    const payload = mkPayload()
    const v2o = valueToOptionMap(payload)
    const legacy = { ...payload.variants[0]! }
    delete (legacy as { aliasValueIds?: string[] }).aliasValueIds
    expect(variantAnswersTo(legacy, 'B', BACK_BLACK, v2o)).toBe(true)
    expect(variantAnswersTo(legacy, 'B', BACK_MATCH, v2o)).toBe(false)
  })
})

describe('resolveVariant with aliases', () => {
  it('lands on the same chair from either wording', () => {
    const payload = mkPayload(WITH_ALIAS)
    const viaBlack = resolveVariant(payload, { B: BACK_BLACK, C: 'C-black' })
    const viaMatching = resolveVariant(payload, { B: BACK_MATCH, C: 'C-black' })
    expect(viaBlack?.id).toBe('all-black')
    expect(viaMatching?.id).toBe('all-black')
    expect(viaMatching?.sku).toBe(viaBlack?.sku)
  })

  it('never lets an alias shadow a variation that carries the combination itself', () => {
    // 'all-black' stands in for Matching Back, but Quest Crab + Matching Back is a
    // real chair of its own and must win.
    expect(resolveVariant(mkPayload(WITH_ALIAS), { B: BACK_MATCH, C: 'C-crab' })?.id).toBe('crab-matching')
  })

  it('still resolves nothing for a combination nobody sells', () => {
    const payload = mkPayload(WITH_ALIAS)
    // Drop the crab/matching chair: now nothing carries or stands in for it.
    payload.variants = payload.variants.filter((v) => v.id !== 'crab-matching')
    expect(resolveVariant(payload, { B: BACK_MATCH, C: 'C-crab' })).toBeNull()
  })

  it('behaves exactly as before when nothing is aliased', () => {
    expect(resolveVariant(mkPayload(), { B: BACK_MATCH, C: 'C-black' })).toBeNull()
    expect(resolveVariant(mkPayload(), { B: BACK_BLACK, C: 'C-black' })?.id).toBe('all-black')
  })

  it('refuses a partial selection', () => {
    expect(resolveVariant(mkPayload(WITH_ALIAS), { B: BACK_MATCH })).toBeNull()
  })
})

describe('isValueAvailable with aliases', () => {
  it('offers black under the matching wording once aliased', () => {
    expect(isValueAvailable(mkPayload(WITH_ALIAS), { B: BACK_MATCH }, 'C', 'C-black')).toBe(true)
  })

  it('greys black out under the matching wording without the alias', () => {
    expect(isValueAvailable(mkPayload(), { B: BACK_MATCH }, 'C', 'C-black')).toBe(false)
  })

  it('leaves the other colours alone', () => {
    const payload = mkPayload(WITH_ALIAS)
    expect(isValueAvailable(payload, { B: BACK_MATCH }, 'C', 'C-crab')).toBe(true)
    expect(isValueAvailable(payload, { B: BACK_BLACK }, 'C', 'C-crab')).toBe(true)
  })

  it('does not offer an alias for a variation that is not buyable', () => {
    const payload = mkPayload(WITH_ALIAS)
    payload.variants = payload.variants.map((v) => (v.id === 'all-black' ? { ...v, inStock: false } : v))
    expect(isValueAvailable(payload, { B: BACK_MATCH }, 'C', 'C-black')).toBe(false)
  })
})
