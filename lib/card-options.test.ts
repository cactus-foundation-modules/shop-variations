// The card summary is built from data nobody sees until a category page renders,
// and the ways it can quietly go wrong are all in the arithmetic: a "+0" marker,
// a label that prints as an empty string, a cap that hides everything. These are
// pure and cheap to pin down, so they are pinned down here rather than found on a
// live grid.
import { describe, it, expect } from 'vitest'
import { buildCardOptionsFacts, resolvePreviewSource, summariseOptionForCard } from '@/modules/shop-variations/lib/card-options'
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

// The preview lookup is the part a shopper feels: point at a width and the tile
// shows that desk. Everything that decides which photo that is happens in these two
// functions, on data a category page never shows anyone, so it is pinned down here
// rather than found by hovering forty cards.
function width(over: Partial<SvrOptionWithValues> = {}): SvrOptionWithValues {
  return option({
    id: 'opt-width',
    name: 'Width',
    controlType: 'DROPDOWN' as SvrControlType,
    position: 0,
    values: [
      { id: 'w120', optionId: 'opt-width', label: '120cm', slug: '120cm', swatch: null, position: 0, sourceRef: null },
      { id: 'w140', optionId: 'opt-width', label: '140cm', slug: '140cm', swatch: null, position: 1, sourceRef: null },
    ],
    ...over,
  })
}

function finish(over: Partial<SvrOptionWithValues> = {}): SvrOptionWithValues {
  return option({
    id: 'opt-finish',
    name: 'Finish',
    position: 1,
    values: [
      { id: 'walnut', optionId: 'opt-finish', label: 'Walnut', slug: 'walnut', swatch: '#6b4a2b', position: 0, sourceRef: null },
      { id: 'white', optionId: 'opt-finish', label: 'White', slug: 'white', swatch: '#fff', position: 1, sourceRef: null },
    ],
    ...over,
  })
}

const DESK_VARIANTS = [
  { childProductId: 'c-120-walnut', valueIds: ['w120', 'walnut'] },
  { childProductId: 'c-120-white', valueIds: ['w120', 'white'] },
  { childProductId: 'c-140-walnut', valueIds: ['w140', 'walnut'] },
]

describe('buildCardOptionsFacts', () => {
  it('gives every card-shown value a seat and every variation the seats it carries', () => {
    const facts = buildCardOptionsFacts([width(), finish()], DESK_VARIANTS)!
    expect(facts.options.map((o) => o.label)).toEqual(['Width', 'Finish'])
    expect(facts.options[0]!.values.map((v) => v.vi)).toEqual([0, 1])
    expect(facts.options[1]!.values.map((v) => v.vi)).toEqual([2, 3])
    expect(facts.preview!.variants).toEqual([
      { s: 'c-120-walnut', v: [0, 2] },
      { s: 'c-120-white', v: [0, 3] },
      { s: 'c-140-walnut', v: [1, 2] },
    ])
  })

  it('says nothing at all for a product with no option ticked for its card', () => {
    expect(buildCardOptionsFacts([width({ cardDisplay: false })], DESK_VARIANTS)).toBeNull()
  })

  it('still summarises when there is nothing to preview, so the tile keeps its swatches', () => {
    const facts = buildCardOptionsFacts([width(), finish()], [])!
    expect(facts.options).toHaveLength(2)
    expect(facts.preview).toBeUndefined()
  })

  it('ignores values from options the card does not print, and drops a variation left with none', () => {
    const facts = buildCardOptionsFacts([width(), finish({ cardDisplay: false })], [
      { childProductId: 'c-120-walnut', valueIds: ['w120', 'walnut'] },
      { childProductId: 'c-nothing', valueIds: ['walnut'] },
    ])!
    expect(facts.preview!.variants).toEqual([{ s: 'c-120-walnut', v: [0] }])
  })

  it('collapses variations that differ only in something the card never shows, first one wins', () => {
    // Two chairs, same width and finish, different castors - one photo between them
    // as far as a tile is concerned.
    const facts = buildCardOptionsFacts([width()], [
      { childProductId: 'c-120-soft', valueIds: ['w120', 'castor-soft'] },
      { childProductId: 'c-120-hard', valueIds: ['w120', 'castor-hard'] },
    ])!
    expect(facts.preview!.variants).toEqual([{ s: 'c-120-soft', v: [0] }])
  })

  it('seats a value trimmed off the card, so a choice elsewhere can still land on it', () => {
    const facts = buildCardOptionsFacts([width(), finish({ cardLimit: 1 })], DESK_VARIANTS)!
    expect(facts.options[1]!.values.map((v) => v.label)).toEqual(['Walnut'])
    expect(facts.options[1]!.more).toBe(1)
    // White got seat 3 despite never being printed, so the 120cm/White variation is
    // still a distinct entry rather than colliding with the walnut one.
    expect(facts.preview!.variants).toContainEqual({ s: 'c-120-white', v: [0, 3] })
  })
})

describe('resolvePreviewSource', () => {
  const facts = buildCardOptionsFacts([width(), finish()], DESK_VARIANTS)!
  const preview = facts.preview

  it('shows nothing until the shopper points at something', () => {
    expect(resolvePreviewSource(preview, [null, null])).toBeNull()
  })

  it('shows the first variation of a width chosen on its own', () => {
    expect(resolvePreviewSource(preview, [0, null])).toBe('c-120-walnut')
  })

  it('narrows to the combination once a finish is added', () => {
    expect(resolvePreviewSource(preview, [0, 3])).toBe('c-120-white')
  })

  it('answers a finish chosen on its own, with no width in hand', () => {
    expect(resolvePreviewSource(preview, [null, 3])).toBe('c-120-white')
  })

  it('gives up the later choice rather than blanking when the combination does not exist', () => {
    // There is no 140cm in white; the width the shopper actually chose is what
    // survives, exactly as the product page keeps an upstream pick.
    expect(resolvePreviewSource(preview, [1, 3])).toBe('c-140-walnut')
  })

  it('has nothing to say on a product with no preview data', () => {
    expect(resolvePreviewSource(undefined, [0, 1])).toBeNull()
    expect(resolvePreviewSource({ variants: [] }, [0, 1])).toBeNull()
  })
})
