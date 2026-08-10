// Fills shop's `shop.product-card-prices` point: given a batch of products, hands
// back the cheapest a shopper could actually pay for each one that has
// variations, so the storefront card shows it as "From £…" rather than the
// parent's own (unshown) price.
//
// Server-safe, batched: a grid asks once for all its products, and this runs two
// queries for the whole set rather than one per card. Precedent for a provider
// registered through extensionPoints: shop.product-detail-parts ->
// lib/detail-parts-provider.ts.
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { effectivePrice, isOnSale } from '@/modules/shop/lib/pricing'
import type { ShopCardFromPrice, ShopCardPriceProvider } from '@/modules/shop/lib/card-price'
import { getVariantsForProducts, getChildProductFields } from '@/modules/shop-variations/lib/db/variants'

export const shopVariationsCardPrices: ShopCardPriceProvider = {
  async fromPrices(productIds) {
    const out: Record<string, ShopCardFromPrice> = {}
    if (productIds.length === 0) return out

    const variantsByProduct = await getVariantsForProducts(productIds)
    if (variantsByProduct.size === 0) return out

    // Every enabled variant's hidden child product, loaded in one query. A
    // switched-off variant is not on sale, so it does not count towards "from".
    const childIds = [...variantsByProduct.values()]
      .flat()
      .filter((v) => v.enabled)
      .map((v) => v.childProductId)
    if (childIds.length === 0) return out

    // Sale price only undercuts where the shop has sale prices switched on;
    // effectivePrice is shop's own, so a "from" figure and the price the shopper
    // is finally charged can never disagree.
    const { enabledPriceTypes } = await getShopConfigCached()
    const fields = await getChildProductFields(childIds)

    for (const [productId, variants] of variantsByProduct) {
      let cheapest: number | null = null
      let dearest: number | null = null
      let reduced = false
      for (const v of variants) {
        if (!v.enabled) continue
        const child = fields.get(v.childProductId)
        if (!child) continue
        const price = effectivePrice(child, enabledPriceTypes)
        if (cheapest == null || price < cheapest) cheapest = price
        if (dearest == null || price > dearest) dearest = price
        // One reduced variation is enough to put the listing in shop's automatic
        // "On Sale" tag. Same isOnSale shop uses, so the tag and the struck-
        // through price on the variation's own row can never disagree.
        if (isOnSale(child, enabledPriceTypes)) reduced = true
      }
      // Only a real spread is a range. Where every variation costs the same,
      // the card says the price flat out rather than "From" it - a half-penny
      // tolerance so floating-point crumbs cannot invent a range of nothing.
      if (cheapest != null) {
        out[productId] = { price: cheapest.toFixed(2), varies: (dearest ?? cheapest) - cheapest > 0.005, onSale: reduced }
      }
    }
    return out
  },
}
