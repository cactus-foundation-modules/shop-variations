'use client'

import {
  VariantGalleryPart, VariantOptionsPart, VariantPersonalisationPart, VariantPricePart, VariantAddToCartPart,
} from '@/modules/shop-variations/components/public/VariantParts'

// The all-in-one storefront block: gallery + options + personalisation + live
// price + variant-aware add-to-cart, sharing one selection. Each part resolves
// the product slug from the URL, so this needs no product-context injection from
// shop.
export function VariantPurchaseClient({
  preview, showGallery = true, heading, addToCartLabel,
}: { preview?: boolean; showGallery?: boolean; heading?: string; addToCartLabel?: string }) {
  return (
    <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: showGallery ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr', alignItems: 'start' }}>
      {showGallery && <VariantGalleryPart preview={preview} />}
      <div style={{ display: 'grid', gap: '1.25rem', alignContent: 'start' }}>
        {heading && <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{heading}</h2>}
        <VariantOptionsPart preview={preview} />
        <VariantPersonalisationPart preview={preview} />
        <VariantPricePart preview={preview} />
        <VariantAddToCartPart preview={preview} label={addToCartLabel} />
      </div>
    </div>
  )
}
