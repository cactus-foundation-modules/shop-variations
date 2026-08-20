// The `shop.product-canonical-query` provider. Shop asks whether the option
// parameters this request arrived with name a configuration worth indexing in
// its own right, and this answers with the address it published for it.
//
// Why it exists: the sitemap now lists one URL per buyable combination
// (lib/sitemap.ts). Left alone, the product page would go on declaring the bare
// listing canonical for every one of them, so a search engine would be handed a
// list of addresses the pages themselves disown - the sitemap advertising them
// and the page saying "no, index the other one". Either both change or neither
// should.
//
// What it answers:
//  - null on a product with no variations, on a URL carrying no option
//    parameters at all, and on a partial selection. A half-chosen listing IS the
//    bare listing with some controls pre-set, and there is no end to the number
//    of half-chosen addresses a crawler could invent.
//  - otherwise the query string of the VARIATION the parameters resolve to,
//    spelled from that variation's own values in display order. Alias values and
//    a parameter order somebody typed by hand therefore fold onto the one
//    address, which is the tag's whole job.
//
// Server-safe: runs inside generateMetadata, and reads the request's query
// string from shop's own request-scoped holder. Precedent for the pattern:
// lib/social-image-provider.ts.
import { currentProductPageSearchParams } from '@/modules/shop/lib/product-page-params'
import type { ShopProductCanonicalQueryProvider } from '@/modules/shop/lib/product-canonical'
import type { ShpProduct } from '@/modules/shop/lib/types'
import { getVariationBootstrap } from '@/modules/shop-variations/lib/variation-bootstrap'
import { buildVariationQuery, optionParamEntries, selectionValueIdsFromParams } from '@/modules/shop-variations/lib/url-selection'
import { resolveVariant, valueToOptionMap, withAutoSelected, withStrandedFilled, type OptionSelection } from '@/modules/shop-variations/lib/selection-logic'

export const shopVariationsCanonicalQuery: ShopProductCanonicalQueryProvider = {
  async resolve(product: ShpProduct): Promise<string | null> {
    const searchParams = currentProductPageSearchParams()
    if (!searchParams) return null

    const bootstrap = await getVariationBootstrap(product.slug)
    if (!bootstrap) return null
    const { payload } = bootstrap

    // Deliberately NOT bootstrap.preselectOptionValueIds: that is a variation
    // reached through its own child-product slug, whose address is already
    // folded onto the parent's and is not the one published for indexing.
    // Only the parameters actually on this URL are read.
    const valueIds = selectionValueIdsFromParams(payload, searchParams)
    if (valueIds.length === 0) return null

    const valueToOption = valueToOptionMap(payload)
    const raw: OptionSelection = {}
    for (const valueId of valueIds) {
      const optionId = valueToOption.get(valueId)
      if (optionId) raw[optionId] = valueId
    }
    if (Object.keys(raw).length === 0) return null

    // The same derivation the storefront runs, so the address declared canonical
    // is the one for the configuration the page actually opens on: stranded
    // picks filled, then single-choice options settled.
    const optionValues = withAutoSelected(payload, withStrandedFilled(payload, raw))
    const variant = resolveVariant(payload, optionValues)
    if (!variant || !variant.enabled) return null

    // Spelled from the VARIATION's own values rather than from what was typed,
    // so an alias value and a hand-reordered query string both land on the one
    // address - and on exactly the address lib/sitemap.ts published.
    const canonicalSelection: OptionSelection = {}
    for (const valueId of variant.optionValueIds) {
      const optionId = valueToOption.get(valueId)
      if (optionId) canonicalSelection[optionId] = valueId
    }
    if (payload.options.some((o) => !canonicalSelection[o.id])) return null

    return buildVariationQuery(optionParamEntries(payload, canonicalSelection)) || null
  },
}
