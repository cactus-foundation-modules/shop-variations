import { describe, it, expect } from 'vitest'
import { variationCanonicalQuery, type VariationUrlOption } from './url-selection'

// The one spelling of a variation's published address, shared by lib/sitemap.ts,
// lib/canonical-query-provider.ts and the Google Shopping feed. Anything this
// returns is a URL all three of them commit to; anything it refuses, all three
// fall back on the bare listing.
const OPTIONS: VariationUrlOption[] = [
  { id: 'o-head', name: 'Headrest', values: [
    { id: 'v-with', slug: 'with-headrest' },
    { id: 'v-without', slug: 'without-headrest' },
  ] },
  { id: 'o-uph', name: 'Upholstery Colour', values: [
    { id: 'v-forge', slug: 'rivet-forge' },
    { id: 'v-slate', slug: 'rivet-slate' },
  ] },
]

describe('variationCanonicalQuery', () => {
  it('spells a complete combination in option order', () => {
    expect(variationCanonicalQuery(OPTIONS, ['v-with', 'v-forge']))
      .toBe('headrest=with-headrest&upholstery-colour=rivet-forge')
  })

  it('orders parameters by the options, not by the order the values arrive in', () => {
    expect(variationCanonicalQuery(OPTIONS, ['v-forge', 'v-with']))
      .toBe('headrest=with-headrest&upholstery-colour=rivet-forge')
  })

  it('refuses a half-described combination, which would render the bare listing', () => {
    expect(variationCanonicalQuery(OPTIONS, ['v-with'])).toBeNull()
  })

  it('refuses a combination naming two values of one option', () => {
    expect(variationCanonicalQuery(OPTIONS, ['v-with', 'v-without'])).toBeNull()
  })

  it('refuses a value belonging to no option on this product', () => {
    expect(variationCanonicalQuery(OPTIONS, ['v-with', 'v-forge', 'v-elsewhere'])).toBeNull()
  })

  it('refuses a product whose options would share one parameter name', () => {
    const clashing: VariationUrlOption[] = [
      { id: 'o-a', name: 'Colour', values: [{ id: 'v-a', slug: 'red' }] },
      { id: 'o-b', name: 'Colour!', values: [{ id: 'v-b', slug: 'blue' }] },
    ]
    expect(variationCanonicalQuery(clashing, ['v-a', 'v-b'])).toBeNull()
  })

  it('refuses a product carrying an option with no values at all', () => {
    const withEmpty: VariationUrlOption[] = [...OPTIONS, { id: 'o-legs', name: 'Legs', values: [] }]
    expect(variationCanonicalQuery(withEmpty, ['v-with', 'v-forge'])).toBeNull()
  })

  it('refuses a product with no options recorded', () => {
    expect(variationCanonicalQuery([], [])).toBeNull()
  })

  it('percent-encodes anything a slug has no business containing', () => {
    const options: VariationUrlOption[] = [
      { id: 'o', name: 'Size', values: [{ id: 'v', slug: '1600 & 800' }] },
    ]
    expect(variationCanonicalQuery(options, ['v'])).toBe('size=1600%20%26%20800')
  })
})
