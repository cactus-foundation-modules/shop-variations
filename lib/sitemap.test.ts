import { describe, it, expect } from 'vitest'
import { buildVariationEntries, type OptionRow, type ValueRow, type VariantRow } from './sitemap'

const UPDATED = new Date('2026-01-01T00:00:00.000Z')

function variant(parentSlug: string, valueIds: string[], parentId = 'p1'): VariantRow {
  return { parent_id: parentId, parent_slug: parentSlug, parent_updated_at: UPDATED, value_ids: valueIds }
}

// A chair with two options, exactly as the live one reads.
const OPTIONS: OptionRow[] = [
  { product_id: 'p1', option_id: 'o-head', option_name: 'Headrest' },
  { product_id: 'p1', option_id: 'o-uph', option_name: 'Upholstery Colour' },
]
const VALUES: ValueRow[] = [
  { option_id: 'o-head', value_id: 'v-with', value_slug: 'with-headrest' },
  { option_id: 'o-head', value_id: 'v-without', value_slug: 'without-headrest' },
  { option_id: 'o-uph', value_id: 'v-forge', value_slug: 'rivet-forge' },
  { option_id: 'o-uph', value_id: 'v-slate', value_slug: 'rivet-slate' },
]

describe('buildVariationEntries', () => {
  it('spells each combination as the storefront reads it, in option order', () => {
    const entries = buildVariationEntries('https://example.com', 'ROOT', [variant('prism-chair', ['v-with', 'v-forge'])], OPTIONS, VALUES)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.url).toBe('https://example.com/prism-chair?headrest=with-headrest&upholstery-colour=rivet-forge')
    expect(entries[0]!.lastModified).toBe(UPDATED)
  })

  it('orders parameters by the option order, not by the order the values arrive in', () => {
    const entries = buildVariationEntries('https://example.com', 'ROOT', [variant('prism-chair', ['v-forge', 'v-with'])], OPTIONS, VALUES)
    expect(entries[0]!.url).toBe('https://example.com/prism-chair?headrest=with-headrest&upholstery-colour=rivet-forge')
  })

  it('uses the shop prefix when that is the shop URL style', () => {
    const entries = buildVariationEntries('https://example.com', 'SHOP', [variant('prism-chair', ['v-with', 'v-forge'])], OPTIONS, VALUES)
    expect(entries[0]!.url).toBe('https://example.com/shop/products/prism-chair?headrest=with-headrest&upholstery-colour=rivet-forge')
  })

  it('leaves out a half-described combination, which would render the bare listing', () => {
    const entries = buildVariationEntries('https://example.com', 'ROOT', [variant('prism-chair', ['v-with'])], OPTIONS, VALUES)
    expect(entries).toHaveLength(0)
  })

  it('leaves out a combination naming two values of one option', () => {
    const entries = buildVariationEntries('https://example.com', 'ROOT', [variant('prism-chair', ['v-with', 'v-without'])], OPTIONS, VALUES)
    expect(entries).toHaveLength(0)
  })

  it('drops a whole product whose options would share one parameter name', () => {
    const clashing: OptionRow[] = [
      { product_id: 'p1', option_id: 'o-a', option_name: 'Colour' },
      { product_id: 'p1', option_id: 'o-b', option_name: 'Colour!' },
    ]
    const values: ValueRow[] = [
      { option_id: 'o-a', value_id: 'v-a', value_slug: 'red' },
      { option_id: 'o-b', value_id: 'v-b', value_slug: 'blue' },
    ]
    const entries = buildVariationEntries('https://example.com', 'ROOT', [variant('thing', ['v-a', 'v-b'])], clashing, values)
    expect(entries).toHaveLength(0)
  })

  it('counts an option with no values at all, so its product drops out', () => {
    const withEmpty: OptionRow[] = [...OPTIONS, { product_id: 'p1', option_id: 'o-legs', option_name: 'Legs' }]
    const entries = buildVariationEntries('https://example.com', 'ROOT', [variant('prism-chair', ['v-with', 'v-forge'])], withEmpty, VALUES)
    expect(entries).toHaveLength(0)
  })

  it('publishes one entry per combination and never the same URL twice', () => {
    const entries = buildVariationEntries('https://example.com', 'ROOT', [
      variant('prism-chair', ['v-with', 'v-forge']),
      variant('prism-chair', ['v-without', 'v-slate']),
      variant('prism-chair', ['v-with', 'v-forge']),
    ], OPTIONS, VALUES)
    expect(entries.map((e) => e.url)).toEqual([
      'https://example.com/prism-chair?headrest=with-headrest&upholstery-colour=rivet-forge',
      'https://example.com/prism-chair?headrest=without-headrest&upholstery-colour=rivet-slate',
    ])
  })

  it('percent-encodes anything a slug has no business containing', () => {
    const options: OptionRow[] = [{ product_id: 'p1', option_id: 'o', option_name: 'Size' }]
    const values: ValueRow[] = [{ option_id: 'o', value_id: 'v', value_slug: '1600 & 800' }]
    const entries = buildVariationEntries('https://example.com', 'ROOT', [variant('desk', ['v'])], options, values)
    expect(entries[0]!.url).toBe('https://example.com/desk?size=1600%20%26%20800')
  })

  it('ignores a variation whose parent has no options recorded at all', () => {
    const entries = buildVariationEntries('https://example.com', 'ROOT', [variant('orphan', ['v-with'], 'p-unknown')], OPTIONS, VALUES)
    expect(entries).toHaveLength(0)
  })
})
