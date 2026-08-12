import { prisma } from '@/lib/db/prisma'

// Per-product gallery ordering. One flag today: whether the product's own
// photographs sit BEHIND the variations promoted with "Image up front" rather
// than in front of them (see migration 014).
//
// A row exists only while the flag is on, so the absence of one is the default
// rather than a gap: no backfill, and turning the flag off leaves nothing behind.

export async function getBaseImagesLast(productId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ base_images_last: boolean }>>`
    SELECT "base_images_last" FROM "svr_product_gallery" WHERE "product_id" = ${productId}
  `
  return rows[0]?.base_images_last ?? false
}

export async function setBaseImagesLast(productId: string, last: boolean): Promise<void> {
  if (!last) {
    await prisma.$executeRaw`DELETE FROM "svr_product_gallery" WHERE "product_id" = ${productId}`
    return
  }
  await prisma.$executeRaw`
    INSERT INTO "svr_product_gallery" ("product_id", "base_images_last", "updated_at")
    VALUES (${productId}, true, CURRENT_TIMESTAMP)
    ON CONFLICT ("product_id") DO UPDATE
      SET "base_images_last" = true, "updated_at" = CURRENT_TIMESTAMP
  `
}
