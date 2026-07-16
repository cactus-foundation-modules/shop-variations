'use client'

import {
  VariantGalleryPart, VariantOptionsPart, VariantPersonalisationPart, VariantPricePart, VariantAddToCartPart,
} from '@/modules/shop-variations/components/public/VariantParts'
import type { VariationBootstrap } from '@/modules/shop-variations/lib/types'

// The all-in-one storefront block: gallery + options + personalisation + live
// price + variant-aware add-to-cart, sharing one selection. The RSC half passes
// down the slug and payload it resolved, so this needs no product-context
// injection from shop; each part still falls back to the URL and a fetch if the
// server couldn't work out which product this is.
export function VariantPurchaseClient({
  preview, showGallery = true, heading, addToCartLabel, slug, initial,
}: {
  preview?: boolean
  showGallery?: boolean
  heading?: string
  addToCartLabel?: string
  slug?: string | null
  initial?: VariationBootstrap | null
}) {
  const shared = { preview, slug, initial }
  return (
    <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: showGallery ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr', alignItems: 'start' }}>
      {showGallery && <VariantGalleryPart {...shared} />}
      <div style={{ display: 'grid', gap: '1.25rem', alignContent: 'start' }}>
        {heading && <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{heading}</h2>}
        <VariantOptionsPart {...shared} />
        <VariantPersonalisationPart {...shared} />
        <VariantPricePart {...shared} />
        <VariantAddToCartPart {...shared} label={addToCartLabel} />
      </div>
    </div>
  )
}
