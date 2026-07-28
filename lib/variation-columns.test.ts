import { describe, it, expect } from 'vitest'
import { mergeContributedColumns, mergeValues } from '@/modules/shop-variations/lib/variation-columns'

// The catalogue that produced the fault: every product uses the same handful of
// attributes for its variations, and the attributes module keys each column by the
// product's own assignment id - so the same heading arrives once per product.
const ATTRS = 'product-attributes-for-shop.variant-fields'
const THREE_D = 'product-3d-views-for-shop.variant-fields'

describe('mergeContributedColumns', () => {
  it('collapses one heading contributed by many products into a single column', () => {
    const merged = mergeContributedColumns([
      { providerId: ATTRS, columns: [{ key: 'asg-desk', label: 'Overall Height', order: 0 }] },
      { providerId: ATTRS, columns: [{ key: 'asg-chair', label: 'Overall Height', order: 0 }] },
      { providerId: ATTRS, columns: [{ key: 'asg-stool', label: 'Overall Height', order: 0 }] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.label).toBe('Overall Height')
    expect(merged[0]?.members).toEqual([`${ATTRS}:asg-desk`, `${ATTRS}:asg-chair`, `${ATTRS}:asg-stool`])
  })

  it('matches headings regardless of case and surrounding space, keeping the first spelling', () => {
    const merged = mergeContributedColumns([
      { providerId: ATTRS, columns: [{ key: 'a', label: 'Seat Colour' }] },
      { providerId: ATTRS, columns: [{ key: 'b', label: '  seat colour ' }] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.label).toBe('Seat Colour')
  })

  it('keeps two different headings apart, and one product\'s two helpings of an attribute with them', () => {
    // A product putting Finish up twice gets two headings, so it feeds two
    // columns - which is the whole reason the key is the assignment, not the
    // attribute. Merging must not undo that.
    const merged = mergeContributedColumns([
      {
        providerId: ATTRS,
        columns: [
          { key: 'asg-main', label: 'Main finish', order: 0 },
          { key: 'asg-edge', label: 'Edge finish', order: 1 },
        ],
      },
    ])
    expect(merged.map((c) => c.label)).toEqual(['Main finish', 'Edge finish'])
    expect(merged.map((c) => c.members)).toEqual([[`${ATTRS}:asg-main`], [`${ATTRS}:asg-edge`]])
  })

  it('does not merge same-named columns from different providers', () => {
    const merged = mergeContributedColumns([
      { providerId: ATTRS, columns: [{ key: 'asg-1', label: 'Files' }] },
      { providerId: THREE_D, columns: [{ key: '3d', label: 'Files', kind: 'file' }] },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]?.id).not.toBe(merged[1]?.id)
  })

  it('orders each contribution by the provider\'s own order, providers kept together', () => {
    const merged = mergeContributedColumns([
      {
        providerId: ATTRS,
        columns: [
          { key: 'b', label: 'Width', order: 5 },
          { key: 'a', label: 'Height', order: 1 },
        ],
      },
      { providerId: THREE_D, columns: [{ key: '3d', label: '3D Files', order: 10, kind: 'file' }] },
    ])
    expect(merged.map((c) => c.label)).toEqual(['Height', 'Width', '3D Files'])
  })

  it('carries the file kind through, defaulting the rest to text', () => {
    const merged = mergeContributedColumns([
      { providerId: THREE_D, columns: [{ key: '3d', label: '3D Files', kind: 'file' }] },
      { providerId: ATTRS, columns: [{ key: 'asg-1', label: 'Overall Height' }] },
    ])
    expect(merged.map((c) => c.kind)).toEqual(['file', 'text'])
  })

  it('ignores a member key it has already seen (the same product asked for twice)', () => {
    const merged = mergeContributedColumns([
      { providerId: THREE_D, columns: [{ key: '3d', label: '3D Files', kind: 'file' }] },
      { providerId: THREE_D, columns: [{ key: '3d', label: '3D Files', kind: 'file' }] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.members).toEqual([`${THREE_D}:3d`])
  })
})

describe('mergeValues', () => {
  const columns = mergeContributedColumns([
    { providerId: ATTRS, columns: [{ key: 'asg-desk', label: 'Overall Height' }] },
    { providerId: ATTRS, columns: [{ key: 'asg-chair', label: 'Overall Height' }] },
    { providerId: THREE_D, columns: [{ key: '3d', label: '3D Files', kind: 'file' }] },
  ])

  it('re-keys a child\'s values onto the merged column, whichever product fed it', () => {
    expect(mergeValues({ [`${ATTRS}:asg-chair`]: '720mm' }, columns)).toEqual({
      [columns[0]!.id]: '720mm',
    })
  })

  it('leaves a column out entirely when the child has nothing for it', () => {
    expect(mergeValues({ [`${ATTRS}:asg-desk`]: '' }, columns)).toEqual({})
    expect(mergeValues(undefined, columns)).toEqual({})
  })

  it('keeps a file column\'s pipe-separated value intact', () => {
    expect(mergeValues({ [`${THREE_D}:3d`]: 'https://x/a.glb|https://x/b.glb' }, columns)[columns[1]!.id])
      .toBe('https://x/a.glb|https://x/b.glb')
  })
})
