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
import { effectivePrice, isOnSale, isPriceTypeEnabled } from '@/modules/shop/lib/pricing'
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

    // An RRP is only ever a comparison, so it follows the same rule here as it
    // does on a single-priced product: quoted only where the shop has retail
    // prices switched on at all.
    const retailShown = isPriceTypeEnabled(enabledPriceTypes, 'retail')

    for (const [productId, variants] of variantsByProduct) {
      let cheapest: number | null = null
      let dearest: number | null = null
      let cheapestRrp: number | null = null
      let reduced = false
      for (const v of variants) {
        if (!v.enabled) continue
        const child = fields.get(v.childProductId)
        if (!child) continue
        const price = effectivePrice(child, enabledPriceTypes)
        if (cheapest == null || price < cheapest) cheapest = price
        if (dearest == null || price > dearest) dearest = price
        // The lowest RRP on offer, to sit beside the lowest price - both are
        // "from" figures, so the pair a shopper reads is the pair the cheapest
        // end of the range carries. Same test shop's own priceView applies to a
        // single product: a retail figure at or below what is being charged is
        // a typo rather than a saving, and is ignored instead of printed as a
        // comparison that flatters nothing. That test also guarantees the
        // survivor sits above `cheapest`, since it already beats a price that
        // is itself at least the cheapest.
        const retail = retailShown ? child.retailPrice : null
        if (retail != null && retail > price && (cheapestRrp == null || retail < cheapestRrp)) cheapestRrp = retail
        // One reduced variation is enough to put the listing in shop's automatic
        // "On Sale" tag. Same isOnSale shop uses, so the tag and the struck-
        // through price on the variation's own row can never disagree.
        if (isOnSale(child, enabledPriceTypes)) reduced = true
      }
      // Only a real spread is a range. Where every variation costs the same,
      // the card says the price flat out rather than "From" it - a half-penny
      // tolerance so floating-point crumbs cannot invent a range of nothing.
      if (cheapest != null) {
        out[productId] = {
          price: cheapest.toFixed(2),
          varies: (dearest ?? cheapest) - cheapest > 0.005,
          onSale: reduced,
          rrp: cheapestRrp != null ? cheapestRrp.toFixed(2) : null,
        }
      }
    }
    return out
  },
}
