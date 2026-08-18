// Fills shop's `shop.card-media` point with variation photos, so a product card in
// a grid lets the shopper flick through its variations' pictures with the arrows,
// not just the parent's own. One representative image per enabled variation (its
// primary, or its first photo), appended after the product's own images by shop's
// card builder. Variations ticked "Image up front" come first within that tail and
// carry `promoted` - they are the ones already shown with the product's own
// photographs on its page, so the card puts them next to the parent's too and shop's
// hover-swap is allowed to reveal one. The rest of the range follows in matrix order.
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
import { getCardImageFromVariationSet } from '@/modules/shop-variations/lib/db/product-gallery'

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

    // The products whose owner has asked, on the Images tab, that the tile lead
    // with a promoted variation's photo rather than the product's own primary.
    // One query for the whole grid, and empty on every shop that has never
    // touched the setting.
    const leadFromVariation = await getCardImageFromVariationSet([...variantsByProduct.keys()])

    const mediaByChild = await getProductMediaForProducts(childIds)

    for (const [productId, variants] of variantsByProduct) {
      // Two piles, because a variation ticked "Image up front" is a different animal
      // from a plain colour: the promoted ones already sit with the product's own
      // photographs on its page, so they come first here too, ahead of the rest of
      // the range. That keeps the arrows in the same order the gallery is in, and it
      // is what lets shop's hover-swap reveal a promoted photo - shop only ever
      // hovers to the SECOND picture, and it only hovers to a contributed one when
      // it is marked `promoted`.
      const promotedImages: PartImage[] = []
      const plainImages: PartImage[] = []
      // The photo that goes in FRONT of the product's own, where the owner asked
      // for it: the first variation ticked "Image up front" that actually has a
      // picture. Nothing here where the setting is off, or where no promoted
      // variation has one - the card then leads with the product's own, exactly
      // as before.
      let lead: PartImage | null = null
      const wantsLead = leadFromVariation.has(productId)
      for (const v of variants) {
        if (!v.enabled) continue
        // One picture per variation: its primary, else its first still image.
        // Videos-by-URL cannot sit in the card's <img>, same filter shop uses.
        const media = (mediaByChild.get(v.childProductId) ?? []).filter((m) => m.type !== 'VIDEO_URL')
        const primary = media.find((m) => m.isPrimary) ?? media[0]
        // Alt is the media's own where set; empty otherwise - a supplementary
        // carousel image, with the product name already carried by the first.
        // `sourceId` is the variation's child product id, so the card's 3D overlay
        // can show this variation's own model/material when its photo is on screen.
        if (!primary) continue
        // Alt stays the media's own; shop fills a blank one on whichever image
        // ends up leading the card with the product's name, so this does not
        // need the parent rows just to write an alt.
        if (wantsLead && lead === null && v.showImageInGallery) {
          lead = { url: primary.url, alt: primary.altText ?? '', sourceId: v.childProductId }
          continue
        }
        const image: PartImage = { url: primary.url, alt: primary.altText ?? '', sourceId: v.childProductId }
        if (v.showImageInGallery) promotedImages.push({ ...image, promoted: true })
        else plainImages.push(image)
      }
      const images = [...promotedImages, ...plainImages]
      if (images.length > 0 || lead) out.set(productId, { images, leadImages: lead ? [lead] : [] })
    }
    return out
  },
}
