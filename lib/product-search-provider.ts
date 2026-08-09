// Fills shop's `shop.product-search` point: a listing with variations is a match
// for any code that belongs to one of its variations.
//
// A shop that uses variations keeps its supplier codes on the hidden child
// products, not on the listing - so the listing's own SKU column is usually
// empty and the code a customer quotes down the phone, or an owner pastes into
// the admin product list, belongs to a child that no product list is allowed to
// show. Without this, searching for it found nothing at all.
//
// SQL rather than a list of ids, because the caller splices it into a paginated
// query (see modules/shop/lib/product-search.ts). The outer product row is
// aliased `p`; the term is a Prisma parameter, never interpolated.
//
// Disabled variations count. A variation switched off is not on sale, but its
// code is still the code that was on the paperwork, and the listing it belongs
// to is still a real listing - refusing to find it would only look broken.
import { Prisma } from '@prisma/client'
import type { ShopProductSearchProvider } from '@/modules/shop/lib/product-search'

export const shopVariationsProductSearch: ShopProductSearchProvider = {
  matchSql: (term: string) => Prisma.sql`EXISTS (
    SELECT 1 FROM "svr_variants" v
    JOIN "shp_products" cp ON cp."id" = v."child_product_id"
    WHERE v."product_id" = p."id" AND cp."sku" ILIKE ${`%${term}%`}
  )`,
}
