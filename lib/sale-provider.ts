// Fills shop's `shop.product-on-sale` point: whether a listing with variations
// counts as reduced, which is what puts it in the automatic "On Sale" tag and on
// that tag's page.
//
// A parent listing's own sale_price column is almost always empty - the money
// lives on the hidden child product behind each variation - so shop's own answer
// says "not reduced" for every variations listing, and a shop running an offer
// on half its range would fill the sale page with nothing. A listing is reduced
// as soon as any switched-on variation of it is.
//
// SQL rather than a list of ids because shop splices this into the paginated
// list query, where the product row is aliased `p`. Same contract as the
// availability and search providers beside this file.
import { Prisma } from '@prisma/client'
import type { ShopProductSaleProvider } from '@/modules/shop/lib/product-sale'

// The SQL twin of shop's isOnSale, read against a child row: a sale price that
// is set, is not negative, and genuinely undercuts the normal one. A sale price
// at or above the normal price is a typo, not an offer. Whether sale prices are
// switched on shop-wide is settled by the caller before this is ever asked for.
export const shopVariationsOnSale: ShopProductSaleProvider = {
  onSaleSql: () => Prisma.sql`EXISTS (
    SELECT 1 FROM "svr_variants" v
    JOIN "shp_products" c ON c."id" = v."child_product_id"
    WHERE v."product_id" = p."id"
      AND v."enabled" = true
      AND c."status" = 'ACTIVE'
      AND c."sale_price" IS NOT NULL
      AND c."sale_price" >= 0
      AND c."sale_price" < c."price"
  )`,
}
