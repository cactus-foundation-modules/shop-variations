// Fills shop's `shop.card-media` point with variation photos, so a product card in
// a grid lets the shopper flick through its variations' pictures with the arrows,
// not just the parent's own. One representative image per enabled variation (its
// primary, or its first photo), in the variation matrix's own order, appended after
// the product's own images by shop's card builder.
//
// Server-safe, batched: a grid asks once for all its products and this runs two
// queries for the whole set (the variants, then their children's media) rather than
// one per card. Precedent and shape mirror the sibling price provider,
// lib/card-price-provider.ts (the `shop.product-card-prices` point).
//
// Images only - no `Overlay`. A variation photo is just another picture in the
// carousel; nothing here needs a client control.
import { getProductMediaForProducts } from '@/modules/shop/lib/db/products'
import type { ShopCardMediaProvider, ShopCardMediaPayload } from '@/modules/shop/lib/card-media'
import type { PartImage } from '@/modules/shop/components/puck/parts/part-context'
import { getVariantsForProducts } from '@/modules/shop-variations/lib/db/variants'

export const shopVariationsCardMedia: ShopCardMediaProvider = {
  async load(productIds) {
    const out = new Map<string, ShopCardMediaPayload>()
    if (productIds.length === 0) return out

    const variantsByProduct = await getVariantsForProducts(productIds)
    if (variantsByProduct.size === 0) return out

    // A switched-off variation is not on sale, so it does not put a photo on the
    // card - the same rule the price provider applies to the "from" figure.
    const childIds = [...variantsByProduct.values()]
      .flat()
      .filter((v) => v.enabled)
      .map((v) => v.childProductId)
    if (childIds.length === 0) return out

    const mediaByChild = await getProductMediaForProducts(childIds)

    for (const [productId, variants] of variantsByProduct) {
      const images: PartImage[] = []
      for (const v of variants) {
        if (!v.enabled) continue
        // One picture per variation: its primary, else its first still image.
        // Videos-by-URL cannot sit in the card's <img>, same filter shop uses.
        const media = (mediaByChild.get(v.childProductId) ?? []).filter((m) => m.type !== 'VIDEO_URL')
        const primary = media.find((m) => m.isPrimary) ?? media[0]
        // Alt is the media's own where set; empty otherwise - a supplementary
        // carousel image, with the product name already carried by the first.
        if (primary) images.push({ url: primary.url, alt: primary.altText ?? '' })
      }
      if (images.length > 0) out.set(productId, { images })
    }
    return out
  },
}
