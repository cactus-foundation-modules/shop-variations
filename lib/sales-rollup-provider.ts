// Fills shop's `shop.product-sales-rollup` point: tells shop which listing a
// sold variation belongs to, so its best-seller ranking counts sales per listing
// rather than per colour-and-width.
//
// Without this, a chair sold thirty times across fifteen fabrics looks like
// fifteen products that sold twice each, and loses its best-seller slot to
// something genuinely less popular that only comes one way.
//
// Server-safe, batched: one query for every sold product id at once. Precedent
// for a provider registered through extensionPoints: shop.product-card-prices ->
// lib/card-price-provider.ts.
import type { ShopSalesRollupProvider } from '@/modules/shop/lib/popularity'
import { getVariantParentsByChild } from '@/modules/shop-variations/lib/db/variants'

export const shopVariationsSalesRollup: ShopSalesRollupProvider = {
  async parentsByChild(productIds) {
    const out: Record<string, string> = {}
    if (productIds.length === 0) return out
    // Every variant counts, switched off or not: a variation withdrawn from sale
    // today still sold what it sold, and its listing should keep the credit.
    for (const [child, parent] of await getVariantParentsByChild(productIds)) out[child] = parent
    return out
  },
}
