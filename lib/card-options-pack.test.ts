// A card's option summary is drawn from whatever the islands are handed, so a
// value that comes back with the wrong swatch or the wrong seat is a wrong colour
// on a tile or a swatch that previews the wrong photo - and neither throws. Every
// shape a value can take is round-tripped here, through JSON as the real trip is,
// and the islands' reliance on getting the same object back is pinned too.
import { describe, it, expect } from 'vitest'
import { buildCardOptionsFacts, type CardOptionSummary } from '@/modules/shop-variations/lib/card-options'
import { packCardOptions, unpackCardOptions } from '@/modules/shop-variations/lib/card-options-pack'
import type { SvrOptionWithValues } from '@/modules/shop-variations/lib/types'

const SWATCHES = 'https://media.example.test/media/shop/attributes/upholstery-colour/thumb/'

const COLOURS: CardOptionSummary = {
  id: 'colour',
  label: 'Colours',
  kind: 'image',
  values: [
    { label: 'Black', swatch: `${SWATCHES}KgFBxH-sBNdyEUSQzSc3T-black-tiny.webp`, vi: 0 },
    { label: 'Blue', swatch: `${SWATCHES}_zdHqvO_obvQ276Ta6GUj-blue-tiny.webp`, vi: 1 },
    { label: 'Undyed', swatch: null, vi: 2 },
  ],
  more: 0,
  fit: 2,
}

const FRAME: CardOptionSummary = {
  id: 'frame',
  label: 'Frame',
  kind: 'swatch',
  values: [
    { label: 'Chrome', swatch: '#c0c0c0', vi: 3 },
    { label: 'Rust', swatch: 'rgb(183, 65, 14)', vi: undefined },
    { label: 'Blank', swatch: '', vi: 4 },
    { label: 'Relative', swatch: '/media/frame/oak.webp', vi: 5 },
  ],
  more: 7,
}

const SIZES: CardOptionSummary = {
  id: 'size',
  label: 'Widths',
  kind: 'text',
  values: [{ label: '120cm', swatch: null, vi: undefined }, { label: '140cm', swatch: null, vi: 9 }],
  more: 0,
}

function roundTrip(options: CardOptionSummary[]): CardOptionSummary[] {
  return unpackCardOptions(JSON.parse(JSON.stringify(packCardOptions(options))))
}

describe('packCardOptions round trip', () => {
  it('gives back every summary key for key, swatch images, colours, blanks and missing seats included', () => {
    const options = [COLOURS, FRAME, SIZES]
    expect(roundTrip(options)).toStrictEqual(options)
  })

  it('gives back what the card provider actually builds', () => {
    const option: SvrOptionWithValues = {
      id: 'finish', productId: 'desk', name: 'Finish', controlType: 'IMAGE', position: 0, requiresPreviousOption: false,
      sourceProvider: null, sourceRef: null, nameOverridden: false, cardDisplay: true, cardLabel: 'Finishes', cardLimit: null, cardFitLines: 2,
      values: [
        { id: 'oak', optionId: 'finish', label: 'Oak', slug: 'oak', swatch: `${SWATCHES}oak.webp`, swatchSmall: `${SWATCHES}oak-small.webp`, swatchTiny: `${SWATCHES}oak-tiny.webp`, position: 0, sourceRef: null },
        { id: 'walnut', optionId: 'finish', label: 'Walnut', slug: 'walnut', swatch: null, position: 1, sourceRef: null },
      ],
    }
    const facts = buildCardOptionsFacts([option], [])!
    expect(roundTrip(facts.options)).toStrictEqual(facts.options)
  })

  it('names each folder once', () => {
    const packed = packCardOptions([COLOURS, FRAME])
    expect(packed.folders).toEqual([SWATCHES, '/media/frame/'])
    expect(packed.options[0]!.values[0]).toEqual([`Black`, [0, 'KgFBxH-sBNdyEUSQzSc3T-black-tiny.webp'], 0])
    // Nothing to say after the label, so nothing is written.
    expect(packed.options[1]!.values[1]).toEqual(['Rust', 'rgb(183, 65, 14)'])
    expect(packCardOptions([SIZES]).options[0]!.values[0]).toEqual(['120cm'])
  })

  it('carries a card with no summaries', () => {
    expect(roundTrip([])).toStrictEqual([])
  })

  it('hands back the same objects for the same input, both ways', () => {
    // A fit row starts measuring again, and the preview island drops its picks,
    // whenever what it is handed is a different object.
    const options = [COLOURS, SIZES]
    const packed = packCardOptions(options)
    expect(packCardOptions(options)).toBe(packed)
    expect(unpackCardOptions(packed)).toBe(unpackCardOptions(packed))
  })
})
