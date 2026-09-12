// The card's swatch rows and the matrix behind them are now built in two
// different places, and this file pins the one property that makes that safe.
//
// A card ships its option ROWS in the page (server-rendered markup, the visible
// half) and fetches its variation MATRIX on the first sign of interest - 255 KB
// of flight payload off the live homepage, see app/api/public/card-preview. The
// two halves meet through `vi`: a row's value carries a seat number, and the
// matrix answers in seat numbers. So the numbering has to be identical in both
// places or a shopper hovering "Walnut" is shown the photo for whatever else
// happens to sit in that seat - a wrong picture, silently, with no error
// anywhere and every other test still green.
//
// The grid render calls buildCardOptionsFacts(options, []) and the route calls
// buildCardOptionsFacts(options, variants). These assert the seats agree.
import { describe, it, expect } from 'vitest'
import { buildCardOptionsFacts, resolvePreviewSource } from '@/modules/shop-variations/lib/card-options'
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
    cardFitLines: null,
    values: [
      { id: 'v1', optionId: 'opt1', label: 'Red', slug: 'red', swatch: '#f00', position: 0, sourceRef: null },
      { id: 'v2', optionId: 'opt1', label: 'Green', slug: 'green', swatch: '#0f0', position: 1, sourceRef: null },
      { id: 'v3', optionId: 'opt1', label: 'Blue', slug: 'blue', swatch: '#00f', position: 2, sourceRef: null },
    ],
    ...over,
  }
}

const SIZE = option({
  id: 'opt2',
  productId: 'prod1',
  name: 'Size',
  controlType: 'PILL' as SvrControlType,
  position: 1,
  values: [
    { id: 's1', optionId: 'opt2', label: 'Small', slug: 'small', swatch: null, position: 0, sourceRef: null },
    { id: 's2', optionId: 'opt2', label: 'Large', slug: 'large', swatch: null, position: 1, sourceRef: null },
  ],
})

const VARIANTS = [
  { childProductId: 'child-red-small', valueIds: ['v1', 's1'] },
  { childProductId: 'child-red-large', valueIds: ['v1', 's2'] },
  { childProductId: 'child-blue-large', valueIds: ['v3', 's2'] },
]

function seatsOf(facts: ReturnType<typeof buildCardOptionsFacts>): Array<string | number | undefined> {
  return (facts?.options ?? []).flatMap((o) => o.values.flatMap((v) => [`${o.id}:${v.label}`, v.vi]))
}

describe('the rows shipped in the page and the matrix fetched later', () => {
  const options = [option(), SIZE]

  it('hand out the same seats whether or not variants were passed', () => {
    // The grid's call and the route's call, side by side. Same options in, so
    // the same `vi` on every value out.
    const inPage = buildCardOptionsFacts(options, [])
    const fromRoute = buildCardOptionsFacts(options, VARIANTS)
    expect(seatsOf(inPage)).toEqual(seatsOf(fromRoute))
  })

  it('still print every row when no variants are passed', () => {
    // The visible half must not depend on the deferred half in any way.
    const inPage = buildCardOptionsFacts(options, [])
    expect(inPage?.options.map((o) => o.label)).toEqual(['Colour', 'Size'])
    expect(inPage?.options.flatMap((o) => o.values.map((v) => v.label))).toEqual(
      ['Red', 'Green', 'Blue', 'Small', 'Large'],
    )
  })

  it('attach no matrix at all when no variants are passed', () => {
    // Which is what leaves the rows plain rather than interactive until the
    // fetch lands - CardOptionPreview reads a missing matrix as "not yet".
    const inPage = buildCardOptionsFacts(options, [])
    expect(inPage?.preview?.variants ?? []).toEqual([])
  })

  it('resolve a hovered combination to the same child product either way', () => {
    // The whole point, end to end: seats from the page's rows, matrix from the
    // route, and the answer is the variation a shopper actually pointed at.
    const inPage = buildCardOptionsFacts(options, [])
    const fromRoute = buildCardOptionsFacts(options, VARIANTS)
    const colour = inPage!.options.find((o) => o.id === 'opt1')!
    const size = inPage!.options.find((o) => o.id === 'opt2')!
    const blue = colour.values.find((v) => v.label === 'Blue')!.vi!
    const large = size.values.find((v) => v.label === 'Large')!.vi!

    expect(resolvePreviewSource(fromRoute!.preview, [blue, large])).toBe('child-blue-large')

    const red = colour.values.find((v) => v.label === 'Red')!.vi!
    const small = size.values.find((v) => v.label === 'Small')!.vi!
    expect(resolvePreviewSource(fromRoute!.preview, [red, small])).toBe('child-red-small')
  })

  it('keeps a seat for a value the card trimmed off, so the two halves stay aligned', () => {
    // Seats are handed out over EVERY value of a card-shown option, including
    // the ones `cardLimit` hides. A route that numbered only the printed values
    // would be off by one for every option with a limit - which is the exact
    // shape of bug this file is here to stop.
    const limited = [option({ cardLimit: 2 }), SIZE]
    const inPage = buildCardOptionsFacts(limited, [])
    const fromRoute = buildCardOptionsFacts(limited, VARIANTS)
    const size = inPage!.options.find((o) => o.id === 'opt2')!
    // Blue was trimmed from the printed row, so Size's seats must still start
    // after all three colours rather than after the two that were shown.
    expect(size.values.map((v) => v.vi)).toEqual([3, 4])
    expect(seatsOf(inPage)).toEqual(seatsOf(fromRoute))
    // And a combination naming the trimmed colour still resolves, because the
    // seat survived even though the swatch did not.
    expect(resolvePreviewSource(fromRoute!.preview, [2, 4])).toBe('child-blue-large')
  })
})
