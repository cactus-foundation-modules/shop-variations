// The card summary is built from data nobody sees until a category page renders,
// and the ways it can quietly go wrong are all in the arithmetic: a "+0" marker,
// a label that prints as an empty string, a cap that hides everything. These are
// pure and cheap to pin down, so they are pinned down here rather than found on a
// live grid.
import { describe, it, expect } from 'vitest'
import { summariseOptionForCard } from '@/modules/shop-variations/lib/card-options'
import type { SvrOptionWithValues, SvrControlType } from '@/modules/shop-variations/lib/types'

function option(over: Partial<SvrOptionWithValues> = {}): SvrOptionWithValues {
  return {
    id: 'opt1',
    productId: 'prod1',
    name: 'Colour',
    controlType: 'SWATCH' as SvrControlType,
    position: 0,
    requiresPreviousOption: false,
    sourceProvider: null,
    sourceRef: null,
    nameOverridden: false,
    cardDisplay: true,
    cardLabel: null,
    cardLimit: null,
    values: [
      { id: 'v1', optionId: 'opt1', label: 'Red', slug: 'red', swatch: '#f00', position: 0, sourceRef: null },
      { id: 'v2', optionId: 'opt1', label: 'Green', slug: 'green', swatch: '#0f0', position: 1, sourceRef: null },
      { id: 'v3', optionId: 'opt1', label: 'Blue', slug: 'blue', swatch: '#00f', position: 2, sourceRef: null },
    ],
    ...over,
  }
}

describe('summariseOptionForCard', () => {
  it('stays out of the way until the owner asks for it', () => {
    expect(summariseOptionForCard(option({ cardDisplay: false }))).toBeNull()
  })

  it('says nothing for an option with no values rather than printing a bare label', () => {
    expect(summariseOptionForCard(option({ values: [] }))).toBeNull()
  })

  it('shows every value and marks no overflow when there is no cap', () => {
    const summary = summariseOptionForCard(option())!
    expect(summary.values.map((v) => v.label)).toEqual(['Red', 'Green', 'Blue'])
    expect(summary.more).toBe(0)
  })

  it('trims to the cap and counts what is left for the "+N" marker', () => {
    const summary = summariseOptionForCard(option({ cardLimit: 2 }))!
    expect(summary.values.map((v) => v.label)).toEqual(['Red', 'Green'])
    expect(summary.more).toBe(1)
  })

  it('marks no overflow when the cap is at or above the number of values', () => {
    expect(summariseOptionForCard(option({ cardLimit: 3 }))!.more).toBe(0)
    expect(summariseOptionForCard(option({ cardLimit: 9 }))!.more).toBe(0)
  })

  it('treats a cap of zero or less as no cap, rather than hiding every value under a label', () => {
    expect(summariseOptionForCard(option({ cardLimit: 0 }))!.values).toHaveLength(3)
    expect(summariseOptionForCard(option({ cardLimit: -1 }))!.values).toHaveLength(3)
  })

  it('falls back to the option name when the card label is missing or blank', () => {
    expect(summariseOptionForCard(option({ cardLabel: null }))!.label).toBe('Colour')
    expect(summariseOptionForCard(option({ cardLabel: '   ' }))!.label).toBe('Colour')
    expect(summariseOptionForCard(option({ cardLabel: ' Shade ' }))!.label).toBe('Shade')
  })

  it('maps each control type to how the card draws it', () => {
    expect(summariseOptionForCard(option({ controlType: 'SWATCH' }))!.kind).toBe('swatch')
    expect(summariseOptionForCard(option({ controlType: 'IMAGE' }))!.kind).toBe('image')
    expect(summariseOptionForCard(option({ controlType: 'DROPDOWN' }))!.kind).toBe('text')
    expect(summariseOptionForCard(option({ controlType: 'PILL' }))!.kind).toBe('text')
  })

  it('carries a value with no swatch through, so the card can fall back to its label', () => {
    const summary = summariseOptionForCard(option({
      values: [{ id: 'v1', optionId: 'opt1', label: 'Oak', slug: 'oak', swatch: null, position: 0, sourceRef: null }],
    }))!
    expect(summary.values).toEqual([{ label: 'Oak', swatch: null }])
  })
})
