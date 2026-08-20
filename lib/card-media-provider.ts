// Fills shop's `shop.card-media` point with variation photos, so a product card in
// a grid lets the shopper flick through its variations' pictures with the arrows,
// not just the parent's own. One representative image per enabled variation (its
// primary, or its first photo), appended after the product's own images by shop's
// card builder. Variations ticked "Image up front" carry `promoted` and the slot the
// owner dragged them to in the product's Images grid, so they land AMONG the
// product's own photographs on the tile exactly as they do in the gallery - drag one
// to second place and it is the second picture on the tile too, which is the one the
// hover-swap reveals. The rest of the range has no slot and follows behind the lot,
// in matrix order.
//
// The tile and the page it opens must not disagree about what the product looks
// like, and the way to guarantee that is for both to read the one arrangement
// rather than each deciding for itself.
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
      // Two piles, because a variation ticked "Image up front" is a different animal
      // from a plain colour. A promoted one already sits with the product's own
      // photographs in the gallery, at a slot the owner dragged it to on the Images
      // tab, so it carries that same slot here and the card's arrows walk the
      // product page's order rather than an order of their own. That is also what
      // lets shop's hover-swap reveal it: shop only ever hovers to the SECOND
      // picture, and only to a contributed one marked `promoted` - so a variation
      // arranged second is both in the right place and a fair thing to reveal.
      //
      // The rest of the range has no slot and goes behind the lot, which is what a
      // supplementary colour is.
      const promotedImages: PartImage[] = []
      const plainImages: PartImage[] = []
      for (const v of variants) {
        if (!v.enabled) continue
        // One picture per variation: its primary, else its first still image.
        // Videos-by-URL cannot sit in the card's <img>, same filter shop uses.
        const media = (mediaByChild.get(v.childProductId) ?? []).filter((m) => m.type !== 'VIDEO_URL')
        const primary = media.find((m) => m.isPrimary) ?? media[0]
        if (!primary) continue
        // Alt is the media's own where set; empty otherwise - a supplementary
        // carousel image, with the product name already carried by the first, and
        // shop fills a blank alt on whichever picture ends up leading. `sourceId`
        // is the variation's child product id, so the card's 3D overlay can show
        // this variation's own model/material when its photo is on screen.
        const image: PartImage = { url: primary.url, alt: primary.altText ?? '', sourceId: v.childProductId }
        if (v.showImageInGallery) promotedImages.push({ ...image, promoted: true, position: v.galleryPosition })
        else plainImages.push(image)
      }
      const images = [...promotedImages, ...plainImages]
      if (images.length > 0) out.set(productId, { images })
    }
    return out
  },
}
