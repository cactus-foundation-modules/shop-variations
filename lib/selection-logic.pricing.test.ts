import { describe, it, expect } from 'vitest'
import { valuePriceRange, optionAffectsPrice } from '@/modules/shop-variations/lib/selection-logic'
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'

// Two options: Width (W1, W2) and Storage (S1, S2). Width moves the money, storage
// does not - which is the shape the option controls' price hints exist to describe.
//
//   W1+S1 = 246   W1+S2 = 246
//   W2+S1 = 310   W2+S2 = 310
//
// One variant is deliberately switched off and one out of stock, so the maths has
// something unbuyable to ignore.
type Row = { ids: string[]; price?: number; enabled?: boolean; inStock?: boolean }

function mkPayload(overrides: Row[] = []): VariantSelectorPayload {
  const v = (id: string, ids: string[], price: number, enabled = true, inStock = true) =>
    ({ id, childProductId: id, optionValueIds: ids, enabled, inStock, price, compareAtPrice: null, imageUrls: [] })
  const base: Row[] = [
    { ids: ['W1', 'S1'], price: 246 },
    { ids: ['W1', 'S2'], price: 246 },
    { ids: ['W2', 'S1'], price: 310 },
    { ids: ['W2', 'S2'], price: 310 },
  ]
  const rows = overrides.length > 0 ? overrides : base
  return {
    productId: 'p', basePrice: 200, baseImages: [], addons: [],
    options: [
      { id: 'W', name: 'Width', controlType: 'PILL', requiresPreviousOption: false, values: [{ id: 'W1', label: '140cm', swatch: null }, { id: 'W2', label: '180cm', swatch: null }] },
      { id: 'S', name: 'Storage', controlType: 'PILL', requiresPreviousOption: false, values: [{ id: 'S1', label: 'None', swatch: null }, { id: 'S2', label: '2 Drawer', swatch: null }] },
    ],
    variants: rows.map((r, i) => v(`v${i}`, r.ids, r.price ?? 100, r.enabled ?? true, r.inStock ?? true)),
  } as unknown as VariantSelectorPayload
}

describe('valuePriceRange', () => {
  it('is the cheapest and dearest a value can lead to, nothing chosen', () => {
    const p = mkPayload()
    expect(valuePriceRange(p, {}, 'W', 'W1')).toEqual({ min: 246, max: 246 })
    expect(valuePriceRange(p, {}, 'W', 'W2')).toEqual({ min: 310, max: 310 })
    // Storage sits below Width, so with nothing chosen either storage still reaches
    // both widths - hence a range rather than a single figure.
    expect(valuePriceRange(p, {}, 'S', 'S1')).toEqual({ min: 246, max: 310 })
  })

  it('narrows a downstream value to the picks made above it', () => {
    const p = mkPayload()
    expect(valuePriceRange(p, { W: 'W2' }, 'S', 'S1')).toEqual({ min: 310, max: 310 })
  })

  it('ignores a pick made BELOW the option, so an earlier price never moves', () => {
    const p = mkPayload()
    // Choosing a storage must not change what Width says it costs.
    expect(valuePriceRange(p, { S: 'S2' }, 'W', 'W1')).toEqual({ min: 246, max: 246 })
  })

  it('skips variants that are switched off or out of stock', () => {
    const p = mkPayload([
      { ids: ['W1', 'S1'], price: 246, enabled: false },
      { ids: ['W1', 'S2'], price: 400 },
      { ids: ['W2', 'S1'], price: 310, inStock: false },
      { ids: ['W2', 'S2'], price: 320 },
    ])
    expect(valuePriceRange(p, {}, 'W', 'W1')).toEqual({ min: 400, max: 400 })
    expect(valuePriceRange(p, {}, 'W', 'W2')).toEqual({ min: 320, max: 320 })
  })

  it('is null where nothing buyable carries the value', () => {
    const p = mkPayload([
      { ids: ['W1', 'S1'], price: 246 },
      { ids: ['W2', 'S1'], price: 310, enabled: false },
    ])
    expect(valuePriceRange(p, {}, 'W', 'W2')).toBeNull()
  })
})

describe('optionAffectsPrice', () => {
  it('is true for the option whose values differ', () => {
    expect(optionAffectsPrice(mkPayload(), {}, 'W')).toBe(true)
  })

  it('is false for an option whose values all start from the same figure', () => {
    expect(optionAffectsPrice(mkPayload(), {}, 'S')).toBe(false)
  })

  it('is false once an upstream pick has flattened the remaining choices', () => {
    // With the width settled, both storages cost the same 310 - so there is nothing
    // for a price hint under them to say.
    expect(optionAffectsPrice(mkPayload(), { W: 'W2' }, 'S')).toBe(false)
  })

  it('is true where a downstream option genuinely surcharges', () => {
    const p = mkPayload([
      { ids: ['W1', 'S1'], price: 246 },
      { ids: ['W1', 'S2'], price: 289 },
      { ids: ['W2', 'S1'], price: 310 },
      { ids: ['W2', 'S2'], price: 353 },
    ])
    expect(optionAffectsPrice(p, { W: 'W1' }, 'S')).toBe(true)
  })

  it('is false where only one value is reachable at all', () => {
    const p = mkPayload([
      { ids: ['W1', 'S1'], price: 246 },
      { ids: ['W1', 'S2'], price: 289 },
    ])
    // Width has a single reachable value, so there is no difference to report.
    expect(optionAffectsPrice(p, {}, 'W')).toBe(false)
  })

  it('does not invent a difference out of floating-point crumbs', () => {
    const p = mkPayload([
      { ids: ['W1', 'S1'], price: 246.001 },
      { ids: ['W2', 'S1'], price: 246.002 },
    ])
    expect(optionAffectsPrice(p, {}, 'W')).toBe(false)
  })

  it('is false for an option id the payload does not carry', () => {
    expect(optionAffectsPrice(mkPayload(), {}, 'nope')).toBe(false)
  })
})
