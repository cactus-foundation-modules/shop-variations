import { describe, it, expect } from 'vitest'
import { skusToClearForRearrange, type SkuMove } from '@/modules/shop-variations/lib/sku-rearrange'

// Sort so a set-equality assertion doesn't depend on input order.
const cleared = (moves: SkuMove[]): string[] => skusToClearForRearrange(moves).sort()

describe('skusToClearForRearrange', () => {
  it('clears both sides of a straight two-way swap', () => {
    // A: KCUP01 -> KCUP02, B: KCUP02 -> KCUP01. Neither can be written first
    // without colliding, so both must be cleared.
    const moves: SkuMove[] = [
      { id: 'A', from: 'KCUP01', to: 'KCUP02' },
      { id: 'B', from: 'KCUP02', to: 'KCUP01' },
    ]
    expect(cleared(moves)).toEqual(['A', 'B'])
  })

  it('clears every member of a rotation (the whole-column shift that bit the chair)', () => {
    // Three colours rotate their codes: each variant is standing on the SKU the
    // next one wants, so all three must be cleared.
    const moves: SkuMove[] = [
      { id: 'A', from: 'S1', to: 'S2' },
      { id: 'B', from: 'S2', to: 'S3' },
      { id: 'C', from: 'S3', to: 'S1' },
    ]
    expect(cleared(moves)).toEqual(['A', 'B', 'C'])
  })

  it('does not clear a move onto a value no one else holds', () => {
    // A takes a brand-new code; nothing in the batch holds S2, so A can be
    // written directly and needs no pre-clear.
    const moves: SkuMove[] = [{ id: 'A', from: 'S1', to: 'S2' }]
    expect(cleared(moves)).toEqual([])
  })

  it('clears only the variant that blocks a target, not unrelated movers', () => {
    // A wants B's current code (B must be cleared); C moves onto a fresh code
    // and blocks no one, so C is left alone.
    const moves: SkuMove[] = [
      { id: 'A', from: 'S9', to: 'S2' },
      { id: 'B', from: 'S2', to: 'S5' },
      { id: 'C', from: 'S7', to: 'S8' },
    ]
    expect(cleared(moves)).toEqual(['B'])
  })

  it('treats a cleared (blank) SKU as blocking nothing', () => {
    // A is being blanked; its target is null, so it competes for no value and B,
    // which moves onto a fresh code, needs no clear either.
    const moves: SkuMove[] = [
      { id: 'A', from: 'S1', to: null },
      { id: 'B', from: 'S3', to: 'S4' },
    ]
    expect(cleared(moves)).toEqual([])
  })

  it('does not clear a variant a non-mover is competing for (a genuine duplicate stays an error)', () => {
    // Only A is in the batch, moving onto S2. If some other variant NOT in the
    // batch already holds S2, that is a real duplicate the owner must fix - we
    // never clear a row outside the batch, so the write still errors.
    const moves: SkuMove[] = [{ id: 'A', from: 'S1', to: 'S2' }]
    expect(cleared(moves)).toEqual([])
  })

  it('returns nothing when no SKUs actually move', () => {
    const moves: SkuMove[] = [
      { id: 'A', from: 'S1', to: 'S1' },
      { id: 'B', from: null, to: null },
    ]
    expect(cleared(moves)).toEqual([])
  })
})
