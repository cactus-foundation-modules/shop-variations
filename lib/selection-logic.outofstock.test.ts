import { describe, it, expect } from 'vitest'
import { isValueAvailable, isValueOutOfStock } from '@/modules/shop-variations/lib/selection-logic'
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'

// Finish then Frame Colour, which is the shape this exists for: the Deskwell Air
// Lite desk, where the supplier had run dry on every black-legged version at once
// while both wood finishes stayed on the shelf. The picker greyed the black frame
// out and said only "unavailable", which reads as a fault rather than an answer.
function mkPayload(opts: { deadFrames?: string[]; disabledFrames?: string[]; staff?: boolean } = {}): VariantSelectorPayload {
  const dead = new Set(opts.deadFrames ?? [])
  const off = new Set(opts.disabledFrames ?? [])
  const finishes = ['Foak', 'Fwhite']
  const frames = ['Cblack', 'Csilver']
  const variants = finishes.flatMap((f) => frames.map((c) => ({
    id: `${f}-${c}`, childProductId: `${f}-${c}`, optionValueIds: [f, c],
    enabled: !off.has(c), inStock: !dead.has(c),
    price: 10, compareAtPrice: null, imageUrls: [],
  })))
  return {
    productId: 'p', basePrice: 5, baseImages: [], addons: [],
    ...(opts.staff ? { showStockCounts: true } : {}),
    options: [
      { id: 'F', name: 'Finish', controlType: 'IMAGE', requiresPreviousOption: false, values: [{ id: 'Foak', label: 'Oak', swatch: null }, { id: 'Fwhite', label: 'White', swatch: null }] },
      { id: 'C', name: 'Frame Colour', controlType: 'SWATCH', requiresPreviousOption: false, values: [{ id: 'Cblack', label: 'Black', swatch: '#323232' }, { id: 'Csilver', label: 'Silver', swatch: '#7E7E7E' }] },
    ],
    variants,
  } as unknown as VariantSelectorPayload
}

describe('isValueOutOfStock', () => {
  it('calls a value out of stock when every variation carrying it is', () => {
    expect(isValueOutOfStock(mkPayload({ deadFrames: ['Cblack'] }), 'C', 'Cblack')).toBe(true)
  })

  it('leaves a value alone while one variation still has stock', () => {
    const payload = mkPayload()
    const one = payload.variants.find((v) => v.id === 'Foak-Cblack')
    if (one) one.inStock = false
    expect(isValueOutOfStock(payload, 'C', 'Cblack')).toBe(false)
  })

  it('ignores what the shopper has picked, so the answer does not change under them', () => {
    // Picking the finish narrows the black frame to one variation, and that one
    // has stock - but the value itself is not sold out, and must not start
    // claiming to be just because a pick above it moved.
    const payload = mkPayload()
    const one = payload.variants.find((v) => v.id === 'Fwhite-Cblack')
    if (one) one.inStock = false
    expect(isValueOutOfStock(payload, 'C', 'Cblack')).toBe(false)
  })

  it('is not a stock problem when a variation is merely switched off', () => {
    // The owner's own decision, not the warehouse's, so the generic wording stands.
    expect(isValueOutOfStock(mkPayload({ disabledFrames: ['Cblack'] }), 'C', 'Cblack')).toBe(false)
  })

  it('is not a stock problem for a value nothing carries at all', () => {
    expect(isValueOutOfStock(mkPayload(), 'C', 'Cgold')).toBe(false)
  })
})

describe('staff may still pick a sold-out value', () => {
  it('keeps a sold-out value unpickable for a shopper', () => {
    expect(isValueAvailable(mkPayload({ deadFrames: ['Cblack'] }), {}, 'C', 'Cblack')).toBe(false)
  })

  it('opens it back up for staff', () => {
    expect(isValueAvailable(mkPayload({ deadFrames: ['Cblack'], staff: true }), {}, 'C', 'Cblack')).toBe(true)
  })

  it('still holds staff to a switched-off variation', () => {
    expect(isValueAvailable(mkPayload({ disabledFrames: ['Cblack'], staff: true }), {}, 'C', 'Cblack')).toBe(false)
  })
})
