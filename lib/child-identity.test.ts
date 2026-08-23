// The two spellings every variation child carries. Pure functions, so the
// composition is pinned without a database - the sync itself is exercised
// against real rows.
import { describe, it, expect } from 'vitest'
import { variantChildName, variantChildSlug } from '@/modules/shop-variations/lib/child-identity'

describe('variantChildName', () => {
  it('reads as the listing plus its choices', () => {
    expect(variantChildName('Impulse Cantilever Crescent Corner Office Desk', ['160cm', 'Right Hand', 'Maple', 'Silver']))
      .toBe('Impulse Cantilever Crescent Corner Office Desk - 160cm / Right Hand / Maple / Silver')
  })
})

describe('variantChildSlug', () => {
  it('builds on the parent address, not on the parent name', () => {
    expect(variantChildSlug('impulse-cantilever-crescent-corner-office-desk', ['160cm', 'Right Hand', 'Maple', 'Silver']))
      .toBe('impulse-cantilever-crescent-corner-office-desk-160cm-right-hand-maple-silver')
  })

  it('keeps the whole combination past 100 characters', () => {
    const slug = variantChildSlug(
      'air-back-to-back-height-adjustable-bench-desk-with-black-straight-screen',
      ['4 Person', '180cm', '80cm', 'Grey Oak', 'Silver'],
    )
    expect(slug.length).toBeGreaterThan(100)
    expect(slug.endsWith('-grey-oak-silver')).toBe(true)
  })

  it('drops the punctuation a label carries rather than leaving a gap', () => {
    expect(variantChildSlug('brixworth-open-booth', ['3 Seater', 'Rivet Olive & Burnish', 'White']))
      .toBe('brixworth-open-booth-3-seater-rivet-olive-burnish-white')
  })

  it('survives a label that slugifies to nothing at all', () => {
    expect(variantChildSlug('desk', ['&', 'Oak'])).toBe('desk-oak')
    expect(variantChildSlug('desk', ['&'])).toBe('desk')
  })
})
