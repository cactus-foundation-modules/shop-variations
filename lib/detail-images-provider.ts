// Fills shop's `shop.product-detail-images` point with the variations the owner
// has promoted onto the parent's gallery, so a bare details view (the /details
// route a companion module's "Learn more" modal shows) carries the same pictures,
// in the same order, as the product's own page.
//
// The rule is the product page's, reproduced rather than reinvented: enabled
// variations ticked "Image up front", in matrix order, one representative picture
// each - a promoted variation is a taster of the range, and four angles of the oak
// desk would bury the product's own photographs. Where the owner has asked for the
// product's own to sit BEHIND them (the Images tab's setting, `baseImagesLast`),
// they go in front; otherwise behind. See lib/use-variation-selection.ts, which
// applies the same two rules to the live gallery.
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { ShopDetailImagesProvider, ShopExtraDetailImages } from '@/modules/shop/lib/detail-images'
import { getVariants } from '@/modules/shop-variations/lib/db/variants'
import { getBaseImagesLast } from '@/modules/shop-variations/lib/db/product-gallery'

export const shopVariationsDetailImages: ShopDetailImagesProvider = {
  async load(productId): Promise<ShopExtraDetailImages | null> {
    const promoted = (await getVariants(productId)).filter((v) => v.enabled && v.showImageInGallery)
    if (promoted.length === 0) return null

    const childIds = promoted.map((v) => v.childProductId)
    // One query for the whole set, primary first within each child - the same
    // ordering the selector payload builds its `imageUrls` with, so "its first
    // picture" means the same picture here as it does on the product page.
    const rows = await prisma.$queryRaw<{ product_id: string; url: string; alt_text: string | null }[]>`
      SELECT "product_id", "url", "alt_text"
      FROM "shp_product_media"
      WHERE "product_id" IN (${Prisma.join(childIds)}) AND "type" = 'IMAGE'
      ORDER BY "product_id", "is_primary" DESC, "position" ASC
    `
    const firstByChild = new Map<string, { url: string; alt: string }>()
    for (const r of rows) {
      if (firstByChild.has(r.product_id)) continue
      firstByChild.set(r.product_id, { url: r.url, alt: r.alt_text ?? '' })
    }

    // Matrix order, and a variation promoted without a photograph of its own
    // simply contributes none - it may have been promoted for its 3D model.
    const images = promoted.flatMap((v) => {
      const image = firstByChild.get(v.childProductId)
      return image ? [image] : []
    })
    if (images.length === 0) return null

    return { images, placement: (await getBaseImagesLast(productId)) ? 'before' : 'after' }
  },
}
