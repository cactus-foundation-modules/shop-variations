import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { prisma } from '@/lib/db/prisma'
import { getProductIdsWithVariations } from '@/modules/shop-variations/lib/db/variants'
import { Prisma } from '@prisma/client'

// List of products that have any options, variants or add-ons - the "Product
// options" nav page. Joins back to the (non-hidden) parent products for names.
export async function GET() {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error

  const ids = await getProductIdsWithVariations()
  if (ids.length === 0) return NextResponse.json({ products: [] })

  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; variant_count: bigint; addon_count: bigint }>>`
    SELECT p."id", p."name", p."slug",
      (SELECT COUNT(*) FROM "svr_variants" v WHERE v."product_id" = p."id")::bigint AS variant_count,
      (SELECT COUNT(*) FROM "svr_addons" a WHERE a."product_id" = p."id")::bigint AS addon_count
    FROM "shp_products" p
    WHERE p."id" IN (${Prisma.join(ids)}) AND p."catalogue_hidden" = false
    ORDER BY p."name" ASC
  `
  return NextResponse.json({
    products: rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, variantCount: Number(r.variant_count), addonCount: Number(r.addon_count) })),
  })
}
