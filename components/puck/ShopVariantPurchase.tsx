import { VariantPurchaseClient } from '@/modules/shop-variations/components/public/VariantPurchaseClient'

// Composite storefront block (the default most owners use). Server wrapper -> the
// VariantPurchaseClient island, so Puck's <Render> only crosses plain props.
// Editor render is preview (labelled skeletons, no fetch); the RSC render is live.

export type ShopVariantPurchaseProps = { showGallery?: string; heading?: string; addToCartLabel?: string }

const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]

export function ShopVariantPurchase(props: ShopVariantPurchaseProps) {
  return <VariantPurchaseClient preview showGallery={props.showGallery !== 'no'} heading={props.heading} addToCartLabel={props.addToCartLabel} />
}

export const shopVariantPurchasePuckComponent = {
  label: 'Shop: Variant Purchase',
  fields: {
    showGallery: { type: 'select' as const, label: 'Show gallery', options: yesNo },
    heading: { type: 'text' as const, label: 'Heading (optional)' },
    addToCartLabel: { type: 'text' as const, label: 'Add-to-cart label' },
  },
  defaultProps: { showGallery: 'yes', heading: '', addToCartLabel: 'Add to cart' } as ShopVariantPurchaseProps,
  render: ShopVariantPurchase,
}

export function ShopVariantPurchaseRsc(props: ShopVariantPurchaseProps) {
  return <VariantPurchaseClient showGallery={props.showGallery !== 'no'} heading={props.heading} addToCartLabel={props.addToCartLabel} />
}

export const shopVariantPurchasePuckRscComponent = {
  ...shopVariantPurchasePuckComponent,
  render: ShopVariantPurchaseRsc,
}
