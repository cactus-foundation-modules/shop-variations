import { VariantPurchaseClient } from '@/modules/shop-variations/components/public/VariantPurchaseClient'

// Composite storefront block (the default most owners use). Server wrapper -> the
// VariantPurchaseClient island, so Puck's <Render> only crosses plain props.
//
// Editor half only: labelled skeletons, no fetch, no product. The live RSC half
// is in ShopVariantPurchase.rsc (the manifest's `rscImport`), keeping its payload
// lookup out of the editor's client bundle.

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
