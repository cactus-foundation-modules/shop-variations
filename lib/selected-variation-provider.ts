// The `shop.product-selected-variation` provider. Shop asks which one buyable
// combination the option parameters on this request name, so its structured
// data can describe that chair rather than the range it came from.
//
// Why it exists: the sitemap lists one URL per combination, the canonical tag
// agrees with it (lib/canonical-query-provider.ts), and the Google Shopping feed
// sends one row per combination to exactly those addresses carrying that
// combination's own barcode and its own price. The Product markup was the last
// thing still describing the parent listing - an AggregateOffer spanning every
// colourway, with no barcode on it at all - so a channel following a feed row to
// the page it names found a document that agreed with none of it.
//
// The selection maths is the SAME derivation the canonical provider and the
// storefront hook run, deliberately: three answers to "what did they pick" is
// two too many, and the address in the markup has to be the address in the
// canonical tag.
//
// Declines on a product with no variations and on a URL carrying no option
// parameters at all - a bare listing has no one price, and the range is the
// right answer for it.
//
// It does NOT decline a half-made or unbuyable selection, and that is the point
// of running the storefront's own derivation rather than a stricter one of our
// own. Pick an arm and say nothing about the fabric and the page settles the
// fabric for you; name a combination the owner has since switched off and the
// page moves you to one that is buyable. Either way the shopper is looking at
// one specific chair at one specific price, the canonical tag already names it
// (lib/canonical-query-provider.ts derives it identically), and markup
// describing anything else would be describing a page that does not exist.
//
// The one case with no answer is a listing where nothing at all is buyable: the
// derivation leaves the option empty, resolveVariant refuses a partial
// selection, and this declines - so the page falls back to the range, which is
// the honest thing to say about a listing you cannot buy.
//
// Server-safe: reads the request's query string from shop's own request-scoped
// holder, exactly as lib/canonical-query-provider.ts does.
import { currentProductPageSearchParams } from '@/modules/shop/lib/product-page-params'
import type { ShopSelectedVariation, ShopSelectedVariationProvider } from '@/modules/shop/lib/product-selected-variation'
import type { ShpProduct } from '@/modules/shop/lib/types'
import { getVariationBootstrap } from '@/modules/shop-variations/lib/variation-bootstrap'
import { selectionValueIdsFromParams, variationCanonicalQuery } from '@/modules/shop-variations/lib/url-selection'
import { resolveVariant, valueToOptionMap, withAutoSelected, withStrandedFilled, type OptionSelection } from '@/modules/shop-variations/lib/selection-logic'

export const shopVariationsSelectedVariation: ShopSelectedVariationProvider = {
  async resolve(product: ShpProduct): Promise<ShopSelectedVariation | null> {
    const searchParams = currentProductPageSearchParams()
    if (!searchParams) return null

    const bootstrap = await getVariationBootstrap(product.slug)
    if (!bootstrap) return null
    const { payload } = bootstrap

    // Only the parameters actually on this URL, for the same reason the
    // canonical provider reads only those: a variation reached through its own
    // child slug has its address folded onto the parent's, and the markup must
    // describe the page that is being indexed rather than the one that redirects
    // onto it.
    const valueIds = selectionValueIdsFromParams(payload, searchParams)
    if (valueIds.length === 0) return null

    const valueToOption = valueToOptionMap(payload)
    const raw: OptionSelection = {}
    for (const valueId of valueIds) {
      const optionId = valueToOption.get(valueId)
      if (optionId) raw[optionId] = valueId
    }
    if (Object.keys(raw).length === 0) return null

    const optionValues = withAutoSelected(payload, withStrandedFilled(payload, raw))
    const variant = resolveVariant(payload, optionValues)
    if (!variant || !variant.enabled) return null

    return {
      productId: variant.childProductId,
      // Spelled from the VARIATION's own values, not from what was typed, so
      // this is character-for-character the string the canonical tag carries.
      canonicalQuery: variationCanonicalQuery(payload.options, variant.optionValueIds),
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      // Optional on the payload - one serialised before the field shipped
      // carries no such key, which has to read as "no RRP" rather than throw.
      retailPrice: variant.retailPrice ?? null,
      inStock: variant.inStock,
      imageUrls: variant.imageUrls,
    }
  },
}
