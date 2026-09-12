import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getOptionsWithValuesForProducts } from '@/modules/shop-variations/lib/db/options'
import { getVariantsForProducts, getVariantValueMapForProducts } from '@/modules/shop-variations/lib/db/variants'
import { buildCardOptionsFacts, type CardPreviewVariantInput } from '@/modules/shop-variations/lib/card-options'

// One product card's variation matrix: which photo answers which combination of
// the values the card prints.
//
// WHY IT IS FETCHED. This is what makes a swatch on a tile interactive, and it is
// needed only once somebody points at one - but it used to be serialised into
// every card of every grid. Measured on the live homepage: 4,170 variant entries
// across 31 cards, 255 KB of flight payload, on a page where most visitors never
// hover a swatch. The card's visible rows are untouched server-rendered markup
// either way; only the answer behind them waits, and it is asked for on the
// first pointer-enter of the tile - see CardOptionPreview.
//
// WHY PER PRODUCT, AND WHY A CACHEABLE GET. A shopper hovers one or two cards on
// a page, so per-product is the smallest honest unit and it caches for everybody
// who ever looks at that product - on any grid, on any page. `publicCacheTtl`
// hands the shared-cache headers to the dispatcher (lib/cache/module-api-cache.ts).
//
// THE SEATS HAVE TO AGREE WITH THE CARD'S. `v` is a list of seat numbers, and
// the seats are handed out by buildCardOptionsFacts over the product's
// card-shown option values in the order the database returns them - which is
// what the grid render did too, from the same query. So the same function over
// the same product gives the same numbering by construction. That is why this
// route calls the shared builder rather than assembling the matrix itself.
//
// NOTHING PRIVATE PASSES THROUGH. Which variations a product has and what they
// are called is what the page prints; there is no price, no stock and nothing
// about who is asking.
export const publicCacheTtl = 3600

const Query = z.object({
  // A product id. Anything that is not a product simply has no options, which
  // answers an empty matrix rather than an error - a card whose product has been
  // deleted under it should go quiet, not shout.
  product: z.string().min(1).max(120),
})

export async function GET(req: Request) {
  const url = new URL(req.url)
  const parsed = Query.safeParse({ product: url.searchParams.get('product') ?? '' })
  if (!parsed.success) return NextResponse.json({ error: 'Unknown product.' }, { status: 400 })

  const productId = parsed.data.product
  const optionsByProduct = await getOptionsWithValuesForProducts([productId])
  const options = optionsByProduct.get(productId) ?? []
  // No options on the card means no matrix to answer with, and the block would
  // not have rendered an island in the first place.
  if (options.length === 0 || !options.some((o) => o.cardDisplay)) {
    return NextResponse.json({ variants: [] })
  }

  const [variantsByProduct, valuesByProduct] = await Promise.all([
    getVariantsForProducts([productId]),
    getVariantValueMapForProducts([productId]),
  ])
  const valuesByVariant = valuesByProduct.get(productId) ?? {}
  // A switched-off variation is not on sale, so it is not something to preview -
  // the same rule the card providers apply to their photos, which is what keeps
  // the two lists agreeing about which variations a card knows about.
  const variants: CardPreviewVariantInput[] = (variantsByProduct.get(productId) ?? [])
    .filter((v) => v.enabled)
    .map((v) => ({ childProductId: v.childProductId, valueIds: valuesByVariant[v.id] ?? [] }))

  const facts = buildCardOptionsFacts(options, variants)
  return NextResponse.json(facts?.preview ?? { variants: [] })
}
