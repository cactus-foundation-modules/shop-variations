// Fills shop's `shop.product-detail-images` point with the variations the owner
// has promoted onto the parent's gallery, so a bare details view (the /details
// route a companion module's "Learn more" modal shows) carries the same pictures,
// in the same order, as the product's own page.
//
// The rule is the product page's, reproduced rather than reinvented: enabled
// variations ticked "Image up front", with the photos the owner picked for each
// (their first unless they chose otherwise - see lib/up-front-images.ts), each
// variation's set carrying the slot the owner dragged it to in the product's
// Images grid. Shop lays its own photographs out
// and drops these into those slots; see lib/gallery-order.ts, which the live
// gallery uses to do exactly the same thing.
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { ShopDetailImagesProvider, ShopExtraDetailImages } from '@/modules/shop/lib/detail-images'
import { getVariants } from '@/modules/shop-variations/lib/db/variants'
import { upFrontImageIndexes } from '@/modules/shop-variations/lib/up-front-images'
import { blocksAsPositionedItems } from '@/modules/shop-variations/lib/gallery-order'

export const shopVariationsDetailImages: ShopDetailImagesProvider = {
  async load(productId): Promise<ShopExtraDetailImages | null> {
    const promoted = (await getVariants(productId)).filter((v) => v.enabled && v.showImageInGallery)
    if (promoted.length === 0) return null

    const childIds = promoted.map((v) => v.childProductId)
    // One query for the whole set, primary first within each child - the same
    // ordering the selector payload builds its `imageUrls` with, so "its first
    // picture" means the same picture here as it does on the product page, and
    // a picked photo is found by the same URL.
    const rows = await prisma.$queryRaw<{ product_id: string; url: string; alt_text: string | null }[]>`
      SELECT "product_id", "url", "alt_text"
      FROM "shp_product_media"
      WHERE "product_id" IN (${Prisma.join(childIds)}) AND "type" = 'IMAGE'
      ORDER BY "product_id", "is_primary" DESC, "position" ASC
    `
    const imagesByChild = new Map<string, Array<{ url: string; alt: string }>>()
    for (const r of rows) {
      const list = imagesByChild.get(r.product_id) ?? []
      list.push({ url: r.url, alt: r.alt_text ?? '' })
      imagesByChild.set(r.product_id, list)
    }

    // Matrix order, and a variation promoted without a photograph of its own
    // simply contributes none - it may have been promoted for its 3D model.
    // Shop's merge counts pictures, not variations, so each variation's set is
    // spread into slots of its own that keep it together where it was dragged.
    const images = blocksAsPositionedItems(promoted.map((v) => {
      const own = imagesByChild.get(v.childProductId) ?? []
      const picked = upFrontImageIndexes(own.map((i) => i.url), v.galleryImageUrls).map((i) => own[i]!)
      return { galleryPosition: v.galleryPosition, item: picked }
    })).map(({ galleryPosition, item }) => ({ ...item, position: galleryPosition }))
    if (images.length === 0) return null

    return { images }
  },
}
