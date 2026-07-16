// The server halves of the `shop.product-detail-parts` slot. Shop renders these
// inside its Product Detail RSC tree and hands each one the product's slug, so
// this is the earliest point at which we can turn that slug into a payload - well
// before the browser has run a line of our code.
//
// Each wrapper resolves the payload and hands it to its island in
// DetailSlotPartsClient.tsx as a plain prop. That is the whole fix for the
// out-of-the-box path: the option controls, the chosen combination's price and
// the buy row all arrive in the page's first HTML instead of a fetch or two
// later. `getVariationBootstrap` is request-cached, so the three wrappers below
// share a single query between them.
//
// These are async server components by design, which is what lets them await the
// payload. Shop's slot contract types them as plain components and only ever
// renders them from its own RSC halves (ShopDetail*Rsc), so awaiting here is
// within the contract - see modules/shop/lib/detail-slot.ts.
import { getVariationBootstrap } from '@/modules/shop-variations/lib/variation-bootstrap'
import {
  VariantSlotGalleryClient,
  VariantSlotPriceClient,
  VariantSlotPurchaseClient,
} from '@/modules/shop-variations/components/public/DetailSlotPartsClient'
import type {
  ShopDetailGallerySlotProps,
  ShopDetailPriceSlotProps,
  ShopDetailPurchaseSlotProps,
} from '@/modules/shop/lib/detail-slot'

export async function VariantSlotGallery(props: ShopDetailGallerySlotProps) {
  const initial = await getVariationBootstrap(props.slug)
  return <VariantSlotGalleryClient {...props} initial={initial} />
}

export async function VariantSlotPrice(props: ShopDetailPriceSlotProps) {
  const initial = await getVariationBootstrap(props.slug)
  return <VariantSlotPriceClient {...props} initial={initial} />
}

export async function VariantSlotPurchase(props: ShopDetailPurchaseSlotProps) {
  const initial = await getVariationBootstrap(props.slug)
  return <VariantSlotPurchaseClient {...props} initial={initial} />
}
