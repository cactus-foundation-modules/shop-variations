import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'

// Per-product gallery ordering. Two independent flags (see migrations 014, 015):
//   - baseImagesLast: on the PRODUCT page, the product's own photographs sit
//     BEHIND the variations promoted with "Image up front" rather than in front.
//   - cardImageFromVariation: in a GRID (category, search, related, featured),
//     the picture is the first promoted variation's photo rather than the
//     product's own primary.
//
// A row exists only while at least one is on, so the absence of one is the
// default rather than a gap: no backfill, and turning both off leaves nothing
// behind.

export type ProductGalleryFlags = {
  baseImagesLast: boolean
  cardImageFromVariation: boolean
}

const OFF: ProductGalleryFlags = { baseImagesLast: false, cardImageFromVariation: false }

type Row = { base_images_last: boolean; card_image_from_variation: boolean }

export async function getProductGalleryFlags(productId: string): Promise<ProductGalleryFlags> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "base_images_last", "card_image_from_variation"
    FROM "svr_product_gallery" WHERE "product_id" = ${productId}
  `
  const row = rows[0]
  if (!row) return OFF
  return { baseImagesLast: row.base_images_last, cardImageFromVariation: row.card_image_from_variation }
}

export async function getBaseImagesLast(productId: string): Promise<boolean> {
  return (await getProductGalleryFlags(productId)).baseImagesLast
}

// The grid flag for a whole set of products in one query - a category page asks
// for every product it is about to draw at once, the same bargain the card media
// and price providers strike. Only the products with the flag ON come back, so a
// shop that has never touched it costs one cheap query and nothing else.
export async function getCardImageFromVariationSet(productIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (productIds.length === 0) return out
  const rows = await prisma.$queryRaw<Array<{ product_id: string }>>`
    SELECT "product_id" FROM "svr_product_gallery"
    WHERE "card_image_from_variation" = true AND "product_id" IN (${Prisma.join(productIds)})
  `
  for (const r of rows) out.add(r.product_id)
  return out
}

export async function setProductGalleryFlags(productId: string, flags: ProductGalleryFlags): Promise<void> {
  // Both off means there is nothing to remember: drop the row rather than keep a
  // row of falses, so "no row" stays the only shape a default product has.
  if (!flags.baseImagesLast && !flags.cardImageFromVariation) {
    await prisma.$executeRaw`DELETE FROM "svr_product_gallery" WHERE "product_id" = ${productId}`
    return
  }
  await prisma.$executeRaw`
    INSERT INTO "svr_product_gallery" ("product_id", "base_images_last", "card_image_from_variation", "updated_at")
    VALUES (${productId}, ${flags.baseImagesLast}, ${flags.cardImageFromVariation}, CURRENT_TIMESTAMP)
    ON CONFLICT ("product_id") DO UPDATE
      SET "base_images_last" = ${flags.baseImagesLast},
          "card_image_from_variation" = ${flags.cardImageFromVariation},
          "updated_at" = CURRENT_TIMESTAMP
  `
}
