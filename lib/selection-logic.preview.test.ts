import { describe, it, expect } from 'vitest'
import { previewVariants } from '@/modules/shop-variations/lib/selection-logic'
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'

// Two options, Finish (F) and Size (S). The matrix order is the variants' order.
function mkPayload(): VariantSelectorPayload {
  const v = (id: string, ids: string[], extra: Record<string, unknown> = {}) => ({ id, childProductId: `c-${id}`, optionValueIds: ids, enabled: true, inStock: true, price: 10, compareAtPrice: null, imageUrls: [], ...extra })
  return {
    productId: 'p', basePrice: 5, baseImages: [], addons: [],
    options: [
      { id: 'F', name: 'Finish', controlType: 'PILL', requiresPreviousOption: false, values: [ { id: 'oak', label: 'Oak', swatch: null }, { id: 'walnut', label: 'Walnut', swatch: null } ] },
      { id: 'S', name: 'Size', controlType: 'PILL', requiresPreviousOption: false, values: [ { id: 's120', label: '120', swatch: null }, { id: 's140', label: '140', swatch: null } ] },
    ],
    variants: [
      v('oak120', ['oak', 's120']),
      v('walnut120', ['walnut', 's120'], { enabled: false }),
      v('walnut140', ['walnut', 's140'], { inStock: false }),
      v('oak140', ['oak', 's140']),
      v('walnut120b', ['walnut', 's120']),
    ],
  } as unknown as VariantSelectorPayload
}

const ids = (vs: { id: string }[]) => vs.map((v) => v.id)

describe('previewVariants', () => {
  it('is empty with nothing picked, so the opening view stands', () => {
    expect(previewVariants(mkPayload(), {})).toEqual([])
  })

  it('lists every enabled variation matching the picks, in matrix order', () => {
    expect(ids(previewVariants(mkPayload(), { F: 'oak' }))).toEqual(['oak120', 'oak140'])
  })

  // Switched off is the owner saying the combination does not exist; out of stock
  // is still what that finish looks like.
  it('drops switched-off variations but keeps sold-out ones', () => {
    expect(ids(previewVariants(mkPayload(), { F: 'walnut' }))).toEqual(['walnut140', 'walnut120b'])
  })

  it('narrows on every pick, whichever option it is', () => {
    expect(ids(previewVariants(mkPayload(), { S: 's140' }))).toEqual(['walnut140', 'oak140'])
  })
})
