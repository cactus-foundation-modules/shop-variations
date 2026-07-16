// The shop.product-detail-parts provider. Shop asks, once per product page,
// whether we own how this product is priced and bought; if we do, it renders our
// gallery, price and purchase area in place of its own static ones. That is what
// makes a fresh install's default Product Detail layout handle options with no
// layout editing at all.
//
// Server-safe: claimsProduct runs inside shop's ShopProductDetail.rsc.tsx.
// Precedent for a provider registered through extensionPoints:
// shop.cart-line-resolver -> lib/line-resolver.ts.
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { getAddons } from '@/modules/shop-variations/lib/db/addons'
import {
  VariantSlotGallery,
  VariantSlotPrice,
  VariantSlotPurchase,
} from '@/modules/shop-variations/components/public/DetailSlotParts'
import type { ShopDetailPartsProvider } from '@/modules/shop/lib/detail-slot'
import type { ShpProduct } from '@/modules/shop/lib/types'

export const shopVariationsDetailParts: ShopDetailPartsProvider = {
  // We claim a product that has options to choose or add-ons to fill in. A
  // variant child is a catalogue-hidden row bought through its parent's page, so
  // it never claims on its own account. A product with neither is left entirely
  // to shop - which is why installing this module changes nothing on the
  // products that don't use it.
  async claimsProduct(product: ShpProduct): Promise<boolean> {
    if (product.catalogueHidden) return false
    const [options, addons] = await Promise.all([getOptionsWithValues(product.id), getAddons(product.id)])
    return options.length > 0 || addons.length > 0
  },
  Gallery: VariantSlotGallery,
  Price: VariantSlotPrice,
  PurchaseArea: VariantSlotPurchase,
}
