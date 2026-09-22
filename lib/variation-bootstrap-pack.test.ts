// The packed variation payload is invisible until it goes wrong, and when it goes
// wrong it goes wrong on a live product page: a price on the wrong combination, a
// thumbnail pointing at nothing, a stock flag off by one row. None of that throws.
// So every corner of the shape is pinned here as a round trip - whatever goes in
// must come back deep-equal, key for key - and the shape itself is checked for
// actually being small, since a pack that quietly spelled everything out again
// would pass the round trip too.
import { describe, it, expect } from 'vitest'
import {
  frontCodeStrings,
  packVariationBootstrap,
  unfrontCodeStrings,
  unpackVariationBootstrap,
} from '@/modules/shop-variations/lib/variation-bootstrap-pack'
import type { SvrOptionWithValues, VariantSelectorPayload, VariantSelectorVariant, VariationBootstrap } from '@/modules/shop-variations/lib/types'

const FOLDER = 'https://media.example.test/media/shop/desks/air-desk/variations/'

function option(id: string, values: string[], over: Partial<SvrOptionWithValues> = {}): SvrOptionWithValues {
  return {
    id,
    productId: 'parent',
    name: id,
    controlType: 'PILL',
    position: 0,
    requiresPreviousOption: false,
    sourceProvider: null,
    sourceRef: null,
    nameOverridden: false,
    cardDisplay: false,
    cardLabel: null,
    cardLimit: null,
    cardFitLines: null,
    values: values.map((valueId, position) => ({
      id: valueId, optionId: id, label: valueId, slug: valueId, swatch: null, swatchSmall: null, swatchTiny: null, position, sourceRef: null,
    })),
    ...over,
  }
}

const OPTIONS: SvrOptionWithValues[] = [
  option('width', ['w120', 'w140', 'w160']),
  option('finish', ['oak', 'walnut']),
]

// A variation exactly as getVariantSelectorPayload builds one for a shopper:
// every key set, the returns answers withheld as undefined.
function variant(index: number, over: Partial<VariantSelectorVariant> = {}): VariantSelectorVariant {
  const code = `ha0${1000 + index}`
  return {
    id: `variant-${index}`,
    childProductId: `child-${index}`,
    optionValueIds: ['oak', 'w120'],
    aliasValueIds: [],
    enabled: true,
    price: 415,
    compareAtPrice: null,
    retailPrice: 1058,
    inStock: true,
    stockCount: null,
    tracksStock: true,
    imageUrls: [`${FOLDER}${code}_1.webp`, `${FOLDER}${code}_2.webp`],
    imageThumbUrls: [`${FOLDER}thumb/AFObnv5v91Y5OxIrdhKSK-${code}_1-thumb.webp`, `${FOLDER}thumb/tu-0uU359GmhNbmymMSQb-${code}_2-thumb.webp`],
    imageAlts: [`Air Desk With Cable Ports - 120cm / Oak / ${index}`, `Air Desk With Cable Ports - 120cm / Oak / ${index}`],
    showImageInGallery: false,
    showModelInGallery: false,
    galleryPosition: null,
    sku: null,
    saleSku: null,
    supplier: null,
    minOrderQuantity: 1,
    returnable: undefined,
    returnsDiscretionary: undefined,
    ...over,
  }
}

function payload(variants: VariantSelectorVariant[], over: Partial<VariantSelectorPayload> = {}): VariantSelectorPayload {
  return {
    productId: 'parent',
    productName: 'Air Desk',
    basePrice: 0,
    baseCompareAtPrice: null,
    baseRetailPrice: null,
    baseImages: [{ url: `${FOLDER}hero.webp`, alt: 'Air Desk', thumbUrl: `${FOLDER}thumb/hero-thumb.webp` }],
    options: OPTIONS,
    variants,
    addons: [],
    priceSuffix: 'ex. VAT',
    showStockCounts: false,
    showCodes: false,
    showReturns: false,
    baseReturns: null,
    baseStock: null,
    baseMinOrderQuantity: 1,
    ...over,
  }
}

function bootstrap(variants: VariantSelectorVariant[], over: Partial<VariationBootstrap> = {}): VariationBootstrap {
  return { payload: payload(variants), currencySymbol: '£', ...over }
}

// Through JSON as well as straight back, because the packed shape really does
// cross a serialiser on its way to the browser - and a tuple with a hole in it or
// an `undefined` inside an array would survive a direct call and not the trip.
function roundTrip(input: VariationBootstrap): VariationBootstrap {
  const packed = packVariationBootstrap(input)
  return unpackVariationBootstrap(JSON.parse(JSON.stringify(packed)))
}

describe('packVariationBootstrap round trip', () => {
  it('gives back a shopper payload key for key, returns answers withheld included', () => {
    const input = bootstrap([variant(0), variant(1, { optionValueIds: ['w140', 'walnut'] }), variant(2)])
    const output = roundTrip(input)
    expect(output).toStrictEqual(input)
    // toStrictEqual counts undefined-valued keys; say it out loud anyway, since it
    // is the one place the packed shape carries nothing at all.
    expect('returnable' in output.payload.variants[0]!).toBe(true)
  })

  it('keeps the order a variation lists its option values in', () => {
    const input = bootstrap([variant(0, { optionValueIds: ['walnut', 'w160'] }), variant(1, { optionValueIds: ['w120', 'oak'] })])
    expect(roundTrip(input)).toStrictEqual(input)
  })

  it('carries a value id no option lists', () => {
    const input = bootstrap([variant(0, { optionValueIds: ['gone', 'oak'], aliasValueIds: ['also-gone', 'walnut'] })])
    const packed = packVariationBootstrap(input)
    expect(packed.variants.strayValueIds).toEqual(['gone', 'also-gone'])
    expect(roundTrip(input)).toStrictEqual(input)
  })

  it('carries alias values on the handful of variations that have them', () => {
    const input = bootstrap([variant(0), variant(1, { aliasValueIds: ['walnut'] }), variant(2)])
    const packed = packVariationBootstrap(input)
    expect(packed.variants.aliasValueSeats).toEqual([[1, [4]]])
    expect(roundTrip(input)).toStrictEqual(input)
  })

  it('carries disabled, out of stock and promoted variations, and every non-default figure', () => {
    const input = bootstrap([
      variant(0, { enabled: false }),
      variant(1, { inStock: false, tracksStock: false, stockCount: 0 }),
      variant(2, { showImageInGallery: true, galleryPosition: 3, galleryImageIndexes: [1, 2], showModelInGallery: true }),
      variant(3, { compareAtPrice: 499, price: 399.5, minOrderQuantity: 4, supplier: 'Acme' }),
      variant(4, { sku: 'AIR-120-OAK', saleSku: 'CLR-9', returnable: false, returnsDiscretionary: true }),
      variant(5, { returnable: true, returnsDiscretionary: false }),
    ])
    expect(roundTrip(input)).toStrictEqual(input)
  })

  it('carries null prices and a range with no retail prices at all', () => {
    const input = bootstrap([variant(0, { retailPrice: null }), variant(1, { retailPrice: null })])
    const packed = packVariationBootstrap(input)
    expect(packed.variants.retailPrices).toBeUndefined()
    expect(roundTrip(input)).toStrictEqual(input)
    const mixed = bootstrap([variant(0, { retailPrice: null }), variant(1, { retailPrice: 900.25 })])
    expect(roundTrip(mixed)).toStrictEqual(mixed)
  })

  it('carries a variation with no pictures of its own', () => {
    const input = bootstrap([variant(0, { imageUrls: [], imageThumbUrls: [], imageAlts: [] }), variant(1)])
    expect(roundTrip(input)).toStrictEqual(input)
  })

  it('carries a picture with no small copy on file, and one with no description', () => {
    const input = bootstrap([variant(0, {
      imageThumbUrls: ['', `${FOLDER}thumb/AFObnv5v91Y5OxIrdhKSK-ha01000_2-thumb.webp`],
      imageAlts: ['', 'Oak'],
    })])
    expect(roundTrip(input)).toStrictEqual(input)
  })

  it('spells out a small copy filed anywhere other than where core files renditions', () => {
    const input = bootstrap([variant(0, {
      imageUrls: [`${FOLDER}a.webp`, `${FOLDER}b.jpg`, 'no-slash.png', `${FOLDER}c.webp`],
      imageThumbUrls: ['https://elsewhere.test/small/a.webp', `${FOLDER}thumb/b-thumb.webp`, 'thumb/no-slash-thumb.webp', `${FOLDER}thumb/c-thumb.jpg`],
      imageAlts: ['a', 'b', 'c', 'd'],
    })])
    const packed = packVariationBootstrap(input)
    const pictures = packed.variants.pictures[0]
    expect(Array.isArray(pictures)).toBe(true)
    // b fits the template with nothing between folder and stem; the other two do not.
    expect(Array.isArray(pictures) ? pictures.map((picture) => picture[2]) : null).toEqual([[1, 'a.webp'], '', '', [3, 'c-thumb.jpg']])
    expect(roundTrip(input)).toStrictEqual(input)
  })

  it('carries picture lists that do not line up, verbatim', () => {
    const input = bootstrap([variant(0, { imageThumbUrls: [`${FOLDER}thumb/x-thumb.webp`], imageAlts: ['one', 'two', 'three'] })])
    expect(roundTrip(input)).toStrictEqual(input)
  })

  it('brings optional keys an older cached payload never had back absent, not as defaults', () => {
    const old = variant(0)
    delete old.aliasValueIds
    delete old.retailPrice
    delete old.tracksStock
    delete old.imageThumbUrls
    delete old.imageAlts
    delete old.showImageInGallery
    delete old.showModelInGallery
    delete old.galleryPosition
    delete old.saleSku
    delete old.minOrderQuantity
    const input = bootstrap([old, variant(1)])
    const output = roundTrip(input)
    // Every one of those has a reader that treats absence differently from the
    // usual value: a missing minimum falls back to the parent's, say.
    expect(output.payload.variants[0]).not.toHaveProperty('minOrderQuantity')
    expect(output.payload.variants[0]).not.toHaveProperty('tracksStock')
    expect(output).toStrictEqual(input)
  })

  it('carries the preselection and the rest of the payload untouched', () => {
    const input = bootstrap([variant(0)], { preselectOptionValueIds: ['w120', 'oak'] })
    input.payload = payload(input.payload.variants, {
      showStockCounts: true, showCodes: true, showReturns: true,
      baseStock: { tracked: true, count: 3 }, baseReturns: { policy: 'ALLOWED', note: 'Thirty days.' },
      addons: [{ id: 'engrave', productId: 'parent', type: 'TEXT', label: 'Engraving', required: false, position: 0, config: { pricePerChar: 1.5 } }],
    })
    expect(roundTrip(input)).toStrictEqual(input)
  })

  it('carries a product with no variations', () => {
    const input = bootstrap([])
    expect(roundTrip(input)).toStrictEqual(input)
  })

  it('unpacks the same object once, however many islands ask', () => {
    const packed = packVariationBootstrap(bootstrap([variant(0)]))
    expect(unpackVariationBootstrap(packed)).toBe(unpackVariationBootstrap(packed))
  })

  it('writes each repeated part once', () => {
    const variants = Array.from({ length: 40 }, (_, index) => variant(index))
    const packed = packVariationBootstrap(bootstrap(variants))
    expect(packed.variants.folders).toEqual([FOLDER])
    // Nothing usual about these variations, so no sparse column has anything to say.
    expect(Object.keys(packed.variants).sort()).toEqual(['alts', 'childProductIds', 'folders', 'ids', 'optionValueSeats', 'pictures', 'prices', 'retailPrices'])
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(bootstrap(variants)).length / 3)
  })
})

describe('frontCodeStrings', () => {
  it('writes only what each entry adds to the one before it, and reads it back', () => {
    const table = ['Air Desk - 120cm / Oak / Black', 'Air Desk - 120cm / Oak / Silver', 'Short', 'Air Desk - 140cm', '', 'Air Desk - 140cm / Walnut']
    const coded = frontCodeStrings(table)
    expect(coded[1]).toEqual([25, 'Silver'])
    expect(coded[2]).toBe('Short')
    expect(unfrontCodeStrings(coded)).toEqual(table)
  })

  it('never splits a character that takes two code units', () => {
    const table = ['Desk finish 😀 oak', 'Desk finish 😁 oak']
    const coded = frontCodeStrings(table)
    const second = coded[1]
    expect(Array.isArray(second) ? second[1].codePointAt(0) : null).toBe('😁'.codePointAt(0))
    expect(unfrontCodeStrings(JSON.parse(JSON.stringify(coded)))).toEqual(table)
  })
})
