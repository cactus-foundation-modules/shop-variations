import { VariantPurchaseClient } from '@/modules/shop-variations/components/public/VariantPurchaseClient'
import { bootstrapForCurrentProduct, currentProductSlug } from '@/modules/shop-variations/lib/variation-bootstrap'
import { shopVariantPurchasePuckComponent, type ShopVariantPurchaseProps } from './ShopVariantPurchase'

// Live (RSC) half of the composite block. In its own file for the same reason as
// variant-parts.rsc: the payload lookup pulls in prisma, which must never be
// reachable from the editor bundle that imports ShopVariantPurchase.tsx.
//
// This block sits on the Product page layout rather than inside shop's Product
// Detail template, so the recorded slug is there only once shop's product detail
// has resolved its provider. Where it hasn't, the five parts inside fall back to
// the URL and a fetch, which is what they did unconditionally before.

export async function ShopVariantPurchaseRsc(props: ShopVariantPurchaseProps) {
  const initial = await bootstrapForCurrentProduct()
  return (
    <VariantPurchaseClient
      showGallery={props.showGallery !== 'no'}
      heading={props.heading}
      addToCartLabel={props.addToCartLabel}
      slug={currentProductSlug()}
      initial={initial}
    />
  )
}

export const shopVariantPurchasePuckRscComponent = {
  ...shopVariantPurchasePuckComponent,
  render: ShopVariantPurchaseRsc,
}
