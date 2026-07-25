// The `shop.product-page-resolver` provider. Shop offers us a product-page slug
// it will not show on its own - a catalogue-hidden row - and we say whether it is
// one of our variant children and, if so, which parent product's page should
// render under that URL. That is what turns a variation's own link (the one the
// cart builds, and anyone can share) from a 404 into the parent page opened on
// that exact combination.
//
// Server-safe: `resolve` runs inside shop's Product page server component.
// Precedent for a provider registered through extensionPoints:
// shop.product-detail-parts -> lib/detail-parts-provider.ts.
import { resolveVariantDeepLink } from '@/modules/shop-variations/lib/variants-service'
import { rememberPreselectOptionValues } from '@/modules/shop-variations/lib/variation-bootstrap'
import type { ShopProductPageResolver } from '@/modules/shop/lib/product-page-resolver'
import type { ShpProduct } from '@/modules/shop/lib/types'

export const shopVariationsProductPageResolver: ShopProductPageResolver = {
  async resolve(_slug: string, found: ShpProduct | null): Promise<ShpProduct | null> {
    // Only a row shop actually found can be a variant child. A slug that matched
    // nothing is not ours to claim.
    if (!found) return null
    const deepLink = await resolveVariantDeepLink(found)
    if (!deepLink) return null
    // Stash the combination for this request so the storefront bootstrap opens
    // the selector on it (variation-bootstrap reads this on the way past). Shop
    // wants only the parent product back; the preselection is our own concern,
    // recorded the same way the detail-parts provider records the product slug.
    rememberPreselectOptionValues(deepLink.optionValueIds)
    return deepLink.parent
  },
}
