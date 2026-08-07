// Fills shop's `shop.product-availability` point: whether a listing with
// variations counts as sold out.
//
// A parent listing carries no stock of its own - the stock sits on each hidden
// child product behind a variation - so shop's own columns say "not tracked" for
// every one of them, and a shop set to hide sold-out products would hide nothing
// at all. The answer that matters is: can a shopper still buy any version of
// this? So a listing is out of stock only once every switched-on variation of it
// is, which is also exactly when the picker on its page has nothing left to
// offer.
//
// SQL rather than a list of ids because shop splices this into the grid's own
// query: a page of 24 has to be 24 products with a count underneath it that
// agrees, and filtering ids after the LIMIT gives neither. The product row is
// aliased `p` there, which is the contract shop documents on the provider type.
//
// Precedent for a provider registered through extensionPoints:
// shop.product-card-prices -> lib/card-price-provider.ts.
import { Prisma } from '@prisma/client'
import type { ShopAvailabilityProvider } from '@/modules/shop/lib/stock-visibility'

// A switched-off variation is not on sale, so it neither keeps a listing alive
// nor counts against it - the same rule the "From £…" figure uses.
const ENABLED_VARIANTS = Prisma.sql`
  SELECT 1 FROM "svr_variants" v
  JOIN "shp_products" c ON c."id" = v."child_product_id"
  WHERE v."product_id" = p."id" AND v."enabled" = true AND c."status" = 'ACTIVE'
`

// Shop's own out-of-stock rule, read against a child row: tracks stock, has
// none, will not take a backorder, is not a pre-order. Kept in step with
// isOutOfStock in shop's lib/card-template.tsx and with the `inStock` flag the
// variation picker itself works out (lib/variants-service.ts), because a listing
// hidden from the grid while its picker still shows something buyable would be
// the worst of both.
const CHILD_OUT_OF_STOCK = Prisma.sql`(
  c."track_inventory" = true
  AND COALESCE(c."stock_count", 0) <= 0
  AND c."out_of_stock_behaviour" = 'BLOCK'
  AND c."is_pre_order" = false
)`

export const shopVariationsAvailability: ShopAvailabilityProvider = {
  // Only listings that actually have variations. Everything else is an ordinary
  // product and stays shop's own business.
  ownsSql: () => Prisma.sql`EXISTS (${ENABLED_VARIANTS})`,
  outOfStockSql: () => Prisma.sql`NOT EXISTS (${ENABLED_VARIANTS} AND NOT ${CHILD_OUT_OF_STOCK})`,
}
