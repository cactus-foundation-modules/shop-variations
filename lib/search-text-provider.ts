// Fills the search module's `search.shop-product-text` point: the extra words a
// product should be findable by on the site search, over and above its own name,
// description and SKU.
//
// For a listing with variations that is every one of its variations' codes. They
// live on hidden child products, which the site search deliberately never
// indexes as pages of their own - so without this, a customer quoting the code
// off a quote or a delivery note searched the site and got nothing, while the
// listing that code belongs to sat right there. Indexed against the parent, so
// the parent listing is what comes back.
//
// Codes only. Option labels ("140cm", "Walnut") are already all over the child
// names and the parent's own copy, and repeating them here would only inflate
// every listing's body text and flatten the ranking.
import { prisma } from '@/lib/db/prisma'

export const shopVariationsSearchText = {
  /** Extra indexable text per product id, for a batch of products. Products with
   *  no variations simply do not appear in the result. */
  async textFor(productIds: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    if (productIds.length === 0) return out
    const rows = await prisma.$queryRaw<Array<{ product_id: string; skus: string | null }>>`
      SELECT v."product_id", string_agg(DISTINCT cp."sku", ' ') AS skus
      FROM "svr_variants" v
      JOIN "shp_products" cp ON cp."id" = v."child_product_id"
      WHERE v."product_id" = ANY(${productIds}) AND cp."sku" IS NOT NULL AND cp."sku" <> ''
      GROUP BY v."product_id"
    `
    for (const row of rows) {
      if (row.skus) out[row.product_id] = row.skus
    }
    return out
  },

  /** Parent product ids whose variation codes have moved since the last indexing
   *  run, so an incremental run re-indexes them. A parent's own `updated_at`
   *  never moves when a child is edited, which is why this exists at all.
   *
   *  Covers codes added and codes changed. A variation *deleted* since the last
   *  run leaves nothing behind to notice, so its code stays findable until the
   *  next full rebuild - a dead code turning up the listing it used to belong to
   *  is the mildest of the ways this could be wrong. */
  async changedSince(since: Date): Promise<string[]> {
    const rows = await prisma.$queryRaw<Array<{ product_id: string }>>`
      SELECT DISTINCT v."product_id"
      FROM "svr_variants" v
      JOIN "shp_products" cp ON cp."id" = v."child_product_id"
      WHERE cp."updated_at" > ${since} OR v."created_at" > ${since}
    `
    return rows.map((r) => r.product_id)
  },
}
