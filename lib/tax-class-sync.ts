// A variation's tax class belongs to the listing, not to the variation.
//
// Every variation is a hidden child shp_products row, and shop rates a basket
// line from the CHILD's tax class - so the figure a shopper is charged comes off
// the child, while the price printed on the product page is worked out from the
// PARENT's class (see getVariantSelectorPayload). The children copy the class
// when they are created, and nothing put it back in step afterwards: a shop that
// set up its VAT class after generating its matrices, or moved a range onto a
// different class, ended up quoting the same chair with VAT on the page and
// without it in the basket. The owner is never asked to pick a tax class per
// variation - the editor does not even offer one - so the parent is the only
// answer there is.
//
// Kept as one statement so it is safe to repeat, cheap enough to run on every
// save that touches the field, and a no-op on the parents that are already right.
import { prisma } from '@/lib/db/prisma'

/** Put every one of this parent's variation children onto the parent's tax class.
 *  Returns how many children moved (0 when they already agree, and 0 for a
 *  product with no variations at all). */
export async function syncVariantChildTaxClass(parentId: string): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "shp_products" AS c
    SET "tax_class_id" = p."tax_class_id", "updated_at" = CURRENT_TIMESTAMP
    FROM "svr_variants" v
    JOIN "shp_products" p ON p."id" = v."product_id"
    WHERE c."id" = v."child_product_id"
      AND v."product_id" = ${parentId}
      AND c."tax_class_id" IS DISTINCT FROM p."tax_class_id"
  `
}

/** `shop.product-saved` listener. Shop hands us every field a write carried, so
 *  the overwhelming majority of saves - a price, a description, a stock count -
 *  cost nothing but the array check. */
export async function syncVariationsOnProductSaved(productId: string, changed: readonly string[]): Promise<void> {
  if (!changed.includes('taxClassId')) return
  await syncVariantChildTaxClass(productId)
}
