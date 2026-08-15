import { describe, it, expect } from 'vitest'
import { valueOnSale, optionHasSale } from '@/modules/shop-variations/lib/selection-logic'
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'

// Two options: Width (W1, W2) and Storage (S1, S2). A variation is on offer when
// it carries a compareAtPrice above what it is actually charged - which is what
// the "Sale" badge over an option's name is reading.
type Row = { ids: string[]; price?: number; was?: number | null; enabled?: boolean; inStock?: boolean }

function mkPayload(rows: Row[]): VariantSelectorPayload {
  return {
    productId: 'p', basePrice: 200, baseImages: [], addons: [],
    options: [
      { id: 'W', name: 'Width', controlType: 'PILL', requiresPreviousOption: false, values: [{ id: 'W1', label: '140cm', swatch: null }, { id: 'W2', label: '180cm', swatch: null }] },
      { id: 'S', name: 'Storage', controlType: 'PILL', requiresPreviousOption: false, values: [{ id: 'S1', label: 'None', swatch: null }, { id: 'S2', label: '2 Drawer', swatch: null }] },
    ],
    variants: rows.map((r, i) => ({
      id: `v${i}`, childProductId: `v${i}`, optionValueIds: r.ids,
      enabled: r.enabled ?? true, inStock: r.inStock ?? true,
      price: r.price ?? 100, compareAtPrice: r.was ?? null, imageUrls: [],
    })),
  } as unknown as VariantSelectorPayload
}

// Only the 180cm width is on clearance, whichever storage goes with it.
const oneWidthReduced = () => mkPayload([
  { ids: ['W1', 'S1'], price: 246 },
  { ids: ['W1', 'S2'], price: 289 },
  { ids: ['W2', 'S1'], price: 260, was: 310 },
  { ids: ['W2', 'S2'], price: 300, was: 353 },
])

describe('valueOnSale', () => {
  it('is true for a value some reduced combination carries', () => {
    const p = oneWidthReduced()
    expect(valueOnSale(p, {}, 'W', 'W2')).toBe(true)
    expect(valueOnSale(p, {}, 'W', 'W1')).toBe(false)
  })

  it('narrows a downstream value to the picks made above it', () => {
    const p = oneWidthReduced()
    // Either storage reaches the reduced width while nothing is chosen...
    expect(valueOnSale(p, {}, 'S', 'S1')).toBe(true)
    // ...and neither does once the full-price width is settled.
    expect(valueOnSale(p, { W: 'W1' }, 'S', 'S1')).toBe(false)
    expect(valueOnSale(p, { W: 'W2' }, 'S', 'S1')).toBe(true)
  })

  it('ignores a pick made BELOW the option, so an earlier answer never moves', () => {
    const p = oneWidthReduced()
    expect(valueOnSale(p, { S: 'S2' }, 'W', 'W1')).toBe(false)
    expect(valueOnSale(p, { S: 'S2' }, 'W', 'W2')).toBe(true)
  })

  it('skips a variation that is switched off or out of stock', () => {
    const p = mkPayload([
      { ids: ['W1', 'S1'], price: 246 },
      { ids: ['W2', 'S1'], price: 260, was: 310, enabled: false },
      { ids: ['W2', 'S2'], price: 300, was: 353, inStock: false },
    ])
    expect(valueOnSale(p, {}, 'W', 'W2')).toBe(false)
  })

  it('does not invent a saving out of floating-point crumbs', () => {
    const p = mkPayload([
      { ids: ['W1', 'S1'], price: 246 },
      { ids: ['W2', 'S1'], price: 246.001, was: 246.002 },
    ])
    expect(valueOnSale(p, {}, 'W', 'W2')).toBe(false)
  })
})

describe('optionHasSale', () => {
  it('is true for the option that decides the offer', () => {
    expect(optionHasSale(oneWidthReduced(), {}, 'W')).toBe(true)
  })

  it('is false for an option whose every reachable value reaches the offer', () => {
    // Both storages can reach the reduced width, so Storage narrows nothing about
    // the money and a badge over it would be noise.
    expect(optionHasSale(oneWidthReduced(), {}, 'S')).toBe(false)
  })

  it('is false where nothing is reduced at all', () => {
    const p = mkPayload([
      { ids: ['W1', 'S1'], price: 246 },
      { ids: ['W2', 'S1'], price: 310 },
    ])
    expect(optionHasSale(p, {}, 'W')).toBe(false)
  })

  it('is false where the whole product is reduced', () => {
    const p = mkPayload([
      { ids: ['W1', 'S1'], price: 200, was: 246 },
      { ids: ['W2', 'S1'], price: 260, was: 310 },
    ])
    expect(optionHasSale(p, {}, 'W')).toBe(false)
  })

  it('appears on a downstream option once an upstream pick splits it', () => {
    const p = mkPayload([
      { ids: ['W1', 'S1'], price: 246 },
      { ids: ['W1', 'S2'], price: 250, was: 289 },
      { ids: ['W2', 'S1'], price: 310 },
      { ids: ['W2', 'S2'], price: 353 },
    ])
    // With the narrow width chosen, only the drawer version is reduced.
    expect(optionHasSale(p, { W: 'W1' }, 'S')).toBe(true)
    // With the wide one, neither is.
    expect(optionHasSale(p, { W: 'W2' }, 'S')).toBe(false)
  })

  it('counts only values the shopper can actually reach', () => {
    const p = mkPayload([
      { ids: ['W1', 'S1'], price: 246, was: 300 },
      { ids: ['W2', 'S1'], price: 310, enabled: false },
    ])
    // The full-price width is unbuyable, so the only reachable value is reduced -
    // this option no longer decides anything and gets no badge.
    expect(optionHasSale(p, {}, 'W')).toBe(false)
  })

  it('is false for an option id the payload does not carry', () => {
    expect(optionHasSale(oneWidthReduced(), {}, 'nope')).toBe(false)
  })
})
