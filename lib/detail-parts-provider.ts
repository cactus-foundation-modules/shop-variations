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
import { rememberProductSlug } from '@/modules/shop-variations/lib/variation-bootstrap'
import {
  VariantSlotGallery,
  VariantSlotPrice,
  VariantSlotPurchase,
  VariantSlotSupplierValue,
} from '@/modules/shop-variations/components/public/DetailSlotParts'
import type { ShopDetailPartsProvider, ShopDetailSlotName } from '@/modules/shop/lib/detail-slot'
import type { ShpProduct } from '@/modules/shop/lib/types'

export const shopVariationsDetailParts: ShopDetailPartsProvider = {
  // We claim a product that has options to choose or add-ons to fill in. A
  // variant child is a catalogue-hidden row bought through its parent's page, so
  // it never claims on its own account. A product with neither is left entirely
  // to shop - which is why installing this module changes nothing on the
  // products that don't use it.
  async claimsProduct(product: ShpProduct): Promise<boolean> {
    if (product.catalogueHidden) return false
    // Shop calls this once per product page, before any block renders, and it is
    // the only place shop hands us the product server-side. Recording the slug
    // here is what lets our granular blocks (which Puck gives nothing but their
    // own saved props) resolve their payload while the page is still being built
    // rather than fetching it after hydration. Noted before the claim is
    // decided: a layout can carry our blocks whether or not we claim shop's
    // parts, and an unclaimed product simply has no payload to find.
    rememberProductSlug(product.slug)
    const [options, addons] = await Promise.all([getOptionsWithValues(product.id), getAddons(product.id)])
    return options.length > 0 || addons.length > 0
  },

  // A layout written before shop's own parts learned to handle options does the
  // job with our granular blocks by hand - the default Deskwell product page
  // carries ShopVariantPrice and ShopVariantOptions next to shop's Price and Add
  // to Cart. Claiming those slots on top of that is what put two prices and two
  // option pickers on the page. Where the author has already placed our block
  // for a job, we do not claim shop's part for it as well; shop then renders
  // nothing there and our block is the single source of that answer.
  //
  // Options and personalisation are not slots of shop's - they have no static
  // counterpart to replace - so they cannot be handled here. VariantSlotPurchase
  // drops them itself when the layout places them, via layoutBlockTypes.
  coveredSlots(blockTypes) {
    const covered: ShopDetailSlotName[] = []
    if (blockTypes.has('ShopVariantGallery')) covered.push('Gallery')
    if (blockTypes.has('ShopVariantPrice')) covered.push('Price')
    if (blockTypes.has('ShopVariantAddToCart')) covered.push('PurchaseArea')
    return covered
  },

  Gallery: VariantSlotGallery,
  Price: VariantSlotPrice,
  PurchaseArea: VariantSlotPurchase,
  // No coveredSlots entry: unlike the other three, shop still renders the
  // Specification row itself (label, table markup) - this only ever swaps the
  // value cell, so there is no block-placement case where it would double up.
  SupplierValue: VariantSlotSupplierValue,
}
