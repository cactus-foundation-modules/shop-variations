import { describe, it, expect } from 'vitest'
import { withStrandedFilled, effectiveSelection } from '@/modules/shop-variations/lib/selection-logic'
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'

// Three options A,B,C. Variants define which combos are buyable.
// A1: B1(C1,C2)  A2: B2(C3), B3(C4)
function mkPayload(): VariantSelectorPayload {
  const v = (id: string, ids: string[]) => ({ id, childProductId: id, optionValueIds: ids, enabled: true, inStock: true, price: 10, compareAtPrice: null, imageUrls: [] })
  return {
    productId: 'p', basePrice: 5, baseImages: [], addons: [],
    options: [
      { id: 'A', name: 'A', controlType: 'PILL', requiresPreviousOption: false, values: [ { id: 'A1', label: 'A1', swatch: null }, { id: 'A2', label: 'A2', swatch: null } ] },
      { id: 'B', name: 'B', controlType: 'PILL', requiresPreviousOption: false, values: [ { id: 'B1', label: 'B1', swatch: null }, { id: 'B2', label: 'B2', swatch: null }, { id: 'B3', label: 'B3', swatch: null } ] },
      { id: 'C', name: 'C', controlType: 'PILL', requiresPreviousOption: false, values: [ { id: 'C1', label: 'C1', swatch: null }, { id: 'C2', label: 'C2', swatch: null }, { id: 'C3', label: 'C3', swatch: null }, { id: 'C4', label: 'C4', swatch: null } ] },
    ],
    variants: [
      v('v1', ['A1', 'B1', 'C1']),
      v('v2', ['A1', 'B1', 'C2']),
      v('v3', ['A2', 'B2', 'C3']),
      v('v4', ['A2', 'B3', 'C4']),
    ],
  } as unknown as VariantSelectorPayload
}

describe('withStrandedFilled', () => {
  it('leaves an untouched page empty', () => {
    expect(withStrandedFilled(mkPayload(), {})).toEqual({})
  })

  it('keeps a fully valid selection as-is', () => {
    expect(withStrandedFilled(mkPayload(), { A: 'A1', B: 'B1', C: 'C1' })).toEqual({ A: 'A1', B: 'B1', C: 'C1' })
  })

  it('cascades: change A1->A2 strands B1 AND C1, fills both with first available', () => {
    // Filling B first (B2) re-strands C1, which then fills to C3 - landing on the
    // real buyable variant v3 (A2,B2,C3) rather than a directional near-miss.
    const raw = { A: 'A2', B: 'B1', C: 'C1' }
    const out = withStrandedFilled(mkPayload(), raw)
    expect(out).toEqual({ A: 'A2', B: 'B2', C: 'C3' })
  })

  it('does not fill an option the shopper never chose', () => {
    // Only A picked; B,C never chosen -> stays just A (single-value settle is withAutoSelected's job)
    const out = withStrandedFilled(mkPayload(), { A: 'A2' })
    expect(out).toEqual({ A: 'A2' })
  })

  it('ghost survives: filled value differs from the stranded raw pick', () => {
    const raw = { A: 'A2', B: 'B1', C: 'C1' }
    const out = withStrandedFilled(mkPayload(), raw)
    expect(out.B).not.toBe(raw.B) // B1 stranded -> ghost shows
    expect(out.C).not.toBe(raw.C) // C1 stranded -> ghost shows
    expect(out.A).toBe(raw.A) // A unchanged -> no ghost
  })

  it('contrast: effectiveSelection alone leaves stranded options empty', () => {
    const eff = effectiveSelection(mkPayload(), { A: 'A2', B: 'B1', C: 'C1' })
    expect(eff.B).toBeUndefined()
  })
})
