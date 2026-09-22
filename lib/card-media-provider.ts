// Fills shop's `shop.card-media` point with variation photos, so a product card in
// a grid lets the shopper flick through its variations' pictures with the arrows,
// not just the parent's own. One representative image per enabled variation (its
// primary, or its first photo), appended after the product's own images by shop's
// card builder. Variations ticked "Image up front" bring the photos the owner picked
// for them instead (their first unless chosen otherwise), carry `promoted` and the slot the
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
import { upFrontImageIndexes } from '@/modules/shop-variations/lib/up-front-images'
import { blocksAsPositionedItems, type GalleryPromoted } from '@/modules/shop-variations/lib/gallery-order'

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
      const promotedBlocks: Array<GalleryPromoted<PartImage[]>> = []
      const plainImages: PartImage[] = []
      for (const v of variants) {
        if (!v.enabled) continue
        // One picture per plain variation: its primary, else its first still
        // image. Videos-by-URL cannot sit in the card's <img>, same filter shop
        // uses. Primary first, so "its first photo" is the same one here as on
        // the product page when a promoted variation's pick falls back to it.
        const stills = (mediaByChild.get(v.childProductId) ?? []).filter((m) => m.type !== 'VIDEO_URL')
        const media = [...stills.filter((m) => m.isPrimary), ...stills.filter((m) => !m.isPrimary)]
        const primary = media[0]
        if (!primary) continue
        // Alt is the media's own where set; empty otherwise - a supplementary
        // carousel image, with the product name already carried by the first, and
        // shop fills a blank alt on whichever picture ends up leading. `sourceId`
        // is the variation's child product id, so the card's 3D overlay can show
        // this variation's own model/material when its photo is on screen.
        // The 300px copy where the library has one, same as the product's own
        // pictures get in shop's card builder - a card that shrank the parent's
        // photographs and then pulled full-size variation ones through the arrows
        // would have saved nothing on the range that has the most pictures.
        const toImage = (m: (typeof media)[number]): PartImage => ({
          url: m.thumbUrl ?? m.url,
          fullUrl: m.url,
          alt: m.altText ?? '',
          sourceId: v.childProductId,
        })
        if (v.showImageInGallery) {
          const picked = upFrontImageIndexes(media.map((m) => m.url), v.galleryImageUrls).map((i) => toImage(media[i]!))
          promotedBlocks.push({ galleryPosition: v.galleryPosition, item: picked })
        } else {
          plainImages.push(toImage(primary))
        }
      }
      // Shop's card builder counts pictures, not variations, so each promoted
      // set is spread into slots that keep it together where it was dragged.
      const promotedImages = blocksAsPositionedItems(promotedBlocks)
        .map(({ galleryPosition, item }): PartImage => ({ ...item, promoted: true, position: galleryPosition }))
      const images = [...promotedImages, ...plainImages]
      if (images.length > 0) out.set(productId, { images })
    }
    return out
  },
}
