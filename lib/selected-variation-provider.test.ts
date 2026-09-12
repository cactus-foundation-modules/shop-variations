// The combination a product URL names, as the product page's structured data
// reads it.
//
// The point of the seam: a feed row, the sitemap and the canonical tag all name
// one combination's address, and until this existed the markup at that address
// went on describing the whole range - a price span, no barcode, the listing's
// url. A shopping channel comparing its row against that found nothing it had
// been sent. So the contract worth pinning down is: complete selection in,
// exactly that combination's own figures out; anything less, null, and the page
// describes the listing as it always did.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'
import type { ShpProduct } from '@/modules/shop/lib/types'

const searchParams = vi.hoisted(() => ({ current: null as Record<string, string | string[]> | null }))
const bootstrap = vi.hoisted(() => ({ payload: null as VariantSelectorPayload | null }))

vi.mock('@/modules/shop/lib/product-page-params', () => ({
  currentProductPageSearchParams: () => searchParams.current,
}))
vi.mock('@/modules/shop-variations/lib/variation-bootstrap', () => ({
  getVariationBootstrap: async () => (bootstrap.payload ? { payload: bootstrap.payload } : null),
}))

const { shopVariationsSelectedVariation } = await import('@/modules/shop-variations/lib/selected-variation-provider')

// Two options, four combinations. One is reduced, one is switched off, one is
// off the shelf - so the provider has something to refuse and something to
// quote a "was" against.
function mkPayload(): VariantSelectorPayload {
  const v = (
    id: string,
    ids: string[],
    price: number,
    extra: Partial<{ enabled: boolean; inStock: boolean; compareAtPrice: number | null; retailPrice: number | null; imageUrls: string[] }> = {},
  ) => ({
    id,
    childProductId: `child-${id}`,
    optionValueIds: ids,
    enabled: extra.enabled ?? true,
    inStock: extra.inStock ?? true,
    price,
    compareAtPrice: extra.compareAtPrice ?? null,
    retailPrice: extra.retailPrice ?? null,
    imageUrls: extra.imageUrls ?? [],
  })
  return {
    productId: 'p',
    basePrice: 100,
    baseImages: [],
    addons: [],
    options: [
      { id: 'A', name: 'Arm Option', controlType: 'PILL', requiresPreviousOption: false, values: [
        { id: 'A1', label: 'No Arms', slug: 'no-arms', swatch: null },
        { id: 'A2', label: 'Loop Arms', slug: 'loop-arms', swatch: null },
      ] },
      { id: 'U', name: 'Upholstery Colour', controlType: 'SWATCH', requiresPreviousOption: false, values: [
        { id: 'U1', label: 'Black', slug: 'black', swatch: null },
        { id: 'U2', label: 'Ginseng Chilli', slug: 'ginseng-chilli', swatch: null },
      ] },
    ],
    variants: [
      v('a', ['A1', 'U1'], 109),
      v('b', ['A2', 'U1'], 126, { compareAtPrice: 140, retailPrice: 208, imageUrls: ['/media/loop-black.webp'] }),
      v('c', ['A2', 'U2'], 126, { inStock: false, retailPrice: 208 }),
      v('d', ['A1', 'U2'], 109, { enabled: false }),
    ],
  } as unknown as VariantSelectorPayload
}

const PRODUCT = { id: 'p', slug: 'task-chair' } as unknown as ShpProduct

beforeEach(() => {
  bootstrap.payload = mkPayload()
  searchParams.current = null
})

describe('shopVariationsSelectedVariation', () => {
  it('answers with the combination the parameters name', async () => {
    searchParams.current = { 'arm-option': 'loop-arms', 'upholstery-colour': 'black' }
    const out = await shopVariationsSelectedVariation.resolve(PRODUCT)
    expect(out).toEqual({
      productId: 'child-b',
      canonicalQuery: 'arm-option=loop-arms&upholstery-colour=black',
      price: 126,
      compareAtPrice: 140,
      retailPrice: 208,
      inStock: true,
      imageUrls: ['/media/loop-black.webp'],
    })
  })

  it('spells the address from the variation, not from what was typed', async () => {
    // Parameters in the other order must land on the one published address, or
    // the markup and the canonical tag would name two different pages.
    searchParams.current = { 'upholstery-colour': 'black', 'arm-option': 'loop-arms' }
    const out = await shopVariationsSelectedVariation.resolve(PRODUCT)
    expect(out?.canonicalQuery).toBe('arm-option=loop-arms&upholstery-colour=black')
  })

  it('follows the page off a combination that is out of stock', async () => {
    // The storefront will not sit a shopper on something they cannot buy: the
    // fabric is stranded and the selector moves them to one that is on the
    // shelf. The markup has to describe the chair the page is actually showing,
    // and the canonical tag - same derivation - names that one too.
    searchParams.current = { 'arm-option': 'loop-arms', 'upholstery-colour': 'ginseng-chilli' }
    const out = await shopVariationsSelectedVariation.resolve(PRODUCT)
    expect(out?.productId).toBe('child-b')
    expect(out?.canonicalQuery).toBe('arm-option=loop-arms&upholstery-colour=black')
  })

  it('settles a half-made selection exactly as the page settles it', async () => {
    // One control pre-set and the rest auto-settled is still one chair at one
    // price on screen. Quoting a range over it would describe a page nobody is
    // looking at - and would disagree with the canonical tag, which settles the
    // same way.
    searchParams.current = { 'arm-option': 'loop-arms' }
    const out = await shopVariationsSelectedVariation.resolve(PRODUCT)
    expect(out?.productId).toBe('child-b')
    expect(out?.canonicalQuery).toBe('arm-option=loop-arms&upholstery-colour=black')
  })

  it('moves off a combination the owner has switched off', async () => {
    // Same rule, different cause: the combination named is not sellable at all,
    // so the page offers the nearest one that is.
    searchParams.current = { 'arm-option': 'no-arms', 'upholstery-colour': 'ginseng-chilli' }
    const out = await shopVariationsSelectedVariation.resolve(PRODUCT)
    expect(out?.productId).toBe('child-a')
    expect(out?.canonicalQuery).toBe('arm-option=no-arms&upholstery-colour=black')
  })

  it('declines a listing where nothing at all can be bought', async () => {
    // No value stands in, the derivation leaves the option empty, and a partial
    // selection resolves to no variation - so the page falls back to describing
    // the range, which is the honest thing to say about a listing you cannot buy.
    const payload = mkPayload()
    for (const variant of payload.variants) (variant as { inStock: boolean }).inStock = false
    bootstrap.payload = payload
    searchParams.current = { 'arm-option': 'loop-arms', 'upholstery-colour': 'black' }
    expect(await shopVariationsSelectedVariation.resolve(PRODUCT)).toBeNull()
  })

  it('declines a URL carrying no option parameters at all', async () => {
    searchParams.current = {}
    expect(await shopVariationsSelectedVariation.resolve(PRODUCT)).toBeNull()
  })

  it('declines when nothing parked the query string', async () => {
    searchParams.current = null
    expect(await shopVariationsSelectedVariation.resolve(PRODUCT)).toBeNull()
  })

  it('declines a product with no variations', async () => {
    bootstrap.payload = null
    searchParams.current = { 'arm-option': 'loop-arms', 'upholstery-colour': 'black' }
    expect(await shopVariationsSelectedVariation.resolve(PRODUCT)).toBeNull()
  })

  it('reads a payload predating the RRP field as carrying no RRP', async () => {
    // This payload crosses to the browser as JSON and is held in caches that
    // predate the field. A missing key must read as "no RRP", not throw.
    const payload = mkPayload()
    for (const variant of payload.variants) delete (variant as { retailPrice?: number | null }).retailPrice
    bootstrap.payload = payload
    searchParams.current = { 'arm-option': 'loop-arms', 'upholstery-colour': 'black' }
    expect((await shopVariationsSelectedVariation.resolve(PRODUCT))?.retailPrice).toBeNull()
  })
})
