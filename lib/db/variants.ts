import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { SvrVariant } from '@/modules/shop-variations/lib/types'

function mapVariant(r: Record<string, unknown>): SvrVariant {
  return {
    id: r.id as string,
    productId: r.product_id as string,
    childProductId: r.child_product_id as string,
    enabled: r.enabled as boolean,
    position: r.position as number,
  }
}

export async function getVariants(productId: string): Promise<SvrVariant[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_variants" WHERE "product_id" = ${productId} ORDER BY "position" ASC, "created_at" ASC
  `
  return rows.map(mapVariant)
}

// The per-variant fields the CSV importer diffs against, keyed by the variant's
// hidden child product id. Loaded once for a whole parent so change detection is
// an in-memory lookup rather than a getProductById round-trip per row - which,
// on a parent with hundreds of variants, was the bulk of a slow Google-Sheet
// Pull (every row read its child back just to decide whether anything changed).
export type ChildProductFields = {
  price: number
  // The optional price types, null where unset - the same figures the product
  // editor's Pricing tab holds. Carried here so the CSV importer can tell a
  // genuinely changed retail/trade/cost/sale price from an unchanged one without
  // a per-row round-trip, exactly as it already does for price and stock.
  salePrice: number | null
  retailPrice: number | null
  tradePrice: number | null
  costPrice: number | null
  sku: string | null
  barcode: string | null
  supplier: string | null
  stockCount: number | null
  weight: number | null
}

export async function getChildProductFields(childProductIds: string[]): Promise<Map<string, ChildProductFields>> {
  const map = new Map<string, ChildProductFields>()
  if (childProductIds.length === 0) return map
  const rows = await prisma.$queryRaw<{ id: string; price: unknown; sale_price: unknown; retail_price: unknown; trade_price: unknown; cost_price: unknown; sku: string | null; barcode: string | null; supplier: string | null; stock_count: number | null; weight: unknown }[]>`
    SELECT "id", "price", "sale_price", "retail_price", "trade_price", "cost_price", "sku", "barcode", "supplier", "stock_count", "weight"
    FROM "shp_products" WHERE "id" IN (${Prisma.join(childProductIds)})
  `
  for (const r of rows) {
    map.set(r.id, {
      price: Number(r.price),
      salePrice: r.sale_price == null ? null : Number(r.sale_price),
      retailPrice: r.retail_price == null ? null : Number(r.retail_price),
      tradePrice: r.trade_price == null ? null : Number(r.trade_price),
      costPrice: r.cost_price == null ? null : Number(r.cost_price),
      sku: r.sku ?? null,
      barcode: r.barcode ?? null,
      supplier: r.supplier ?? null,
      stockCount: r.stock_count == null ? null : Number(r.stock_count),
      weight: r.weight == null ? null : Number(r.weight),
    })
  }
  return map
}

// Same as getVariants, for every product in one go - one query instead of one
// per product. Used where a caller needs several parents' worth at once (a
// Pull's preview/deletion planner), which used to call the per-product version
// in a loop.
export async function getVariantsForProducts(productIds: string[]): Promise<Map<string, SvrVariant[]>> {
  const map = new Map<string, SvrVariant[]>()
  if (productIds.length === 0) return map
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_variants" WHERE "product_id" IN (${Prisma.join(productIds)}) ORDER BY "position" ASC, "created_at" ASC
  `
  for (const r of rows) {
    const v = mapVariant(r)
    const list = map.get(v.productId) ?? []
    list.push(v)
    map.set(v.productId, list)
  }
  return map
}

// Same as getVariantValueMap, for every product in one go, keyed by product id
// then variant id.
export async function getVariantValueMapForProducts(productIds: string[]): Promise<Map<string, Record<string, string[]>>> {
  const map = new Map<string, Record<string, string[]>>()
  if (productIds.length === 0) return map
  const rows = await prisma.$queryRaw<{ product_id: string; variant_id: string; option_value_id: string }[]>`
    SELECT v."product_id", vv."variant_id", vv."option_value_id"
    FROM "svr_variant_values" vv
    JOIN "svr_variants" v ON v."id" = vv."variant_id"
    WHERE v."product_id" IN (${Prisma.join(productIds)})
  `
  for (const r of rows) {
    const perProduct = map.get(r.product_id) ?? {}
    ;(perProduct[r.variant_id] ??= []).push(r.option_value_id)
    map.set(r.product_id, perProduct)
  }
  return map
}

export async function getVariantById(id: string): Promise<SvrVariant | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "svr_variants" WHERE "id" = ${id} LIMIT 1`
  return rows[0] ? mapVariant(rows[0]) : null
}

// The parent product a variant (identified by its own id, or by its child
// product id) belongs to - used to gate writes and by the storefront resolver.
export async function getVariantByChildProductId(childProductId: string): Promise<SvrVariant | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "svr_variants" WHERE "child_product_id" = ${childProductId} LIMIT 1`
  return rows[0] ? mapVariant(rows[0]) : null
}

// option_value_ids for each variant of a product, keyed by variant id.
export async function getVariantValueMap(productId: string): Promise<Record<string, string[]>> {
  const rows = await prisma.$queryRaw<{ variant_id: string; option_value_id: string }[]>`
    SELECT vv."variant_id", vv."option_value_id"
    FROM "svr_variant_values" vv
    JOIN "svr_variants" v ON v."id" = vv."variant_id"
    WHERE v."product_id" = ${productId}
  `
  const map: Record<string, string[]> = {}
  for (const r of rows) (map[r.variant_id] ??= []).push(r.option_value_id)
  return map
}

export async function createVariant(productId: string, childProductId: string, optionValueIds: string[], position: number): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<[{ id: string }]>`
      INSERT INTO "svr_variants" ("product_id", "child_product_id", "position")
      VALUES (${productId}, ${childProductId}, ${position})
      RETURNING "id"
    `
    const variantId = rows[0].id
    for (const ovId of optionValueIds) {
      await tx.$executeRaw`
        INSERT INTO "svr_variant_values" ("variant_id", "option_value_id") VALUES (${variantId}, ${ovId})
        ON CONFLICT DO NOTHING
      `
    }
    return { id: variantId }
  })
}

// Rewrite the display position of a set of variants in one statement. Used by the
// resequencer, which recomputes every variant's canonical slot at once - a loop of
// single UPDATEs would be one round trip per variant on a full matrix.
export async function setVariantPositions(positions: { id: string; position: number }[]): Promise<void> {
  if (positions.length === 0) return
  const tuples = positions.map((p) => Prisma.sql`(${p.id}::text, ${p.position}::int)`)
  await prisma.$executeRaw`
    UPDATE "svr_variants" AS v
    SET "position" = c.pos
    FROM (VALUES ${Prisma.join(tuples)}) AS c(id, pos)
    WHERE v."id" = c.id
  `
}

// Replace a variant's option-value set in one transaction. Used by the CSV
// importer's stable-id path when a row keeps its Variant ID but names a
// combination that no longer matches the variant's stored values (a renamed or
// re-pointed value in the sheet).
export async function setVariantValues(variantId: string, optionValueIds: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM "svr_variant_values" WHERE "variant_id" = ${variantId}`
    for (const ovId of optionValueIds) {
      await tx.$executeRaw`
        INSERT INTO "svr_variant_values" ("variant_id", "option_value_id") VALUES (${variantId}, ${ovId})
        ON CONFLICT DO NOTHING
      `
    }
  })
}

export async function setVariantEnabled(id: string, enabled: boolean): Promise<void> {
  await prisma.$executeRaw`UPDATE "svr_variants" SET "enabled" = ${enabled} WHERE "id" = ${id}`
}

export async function deleteVariant(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "svr_variants" WHERE "id" = ${id}`
}

// Count of variant-enabled products (for the admin list) - parents that have at
// least one variant row.
export async function getProductIdsWithVariations(): Promise<string[]> {
  // Order the parents newest-first to match the Products CSV export
  // (lib/db/products.ts sorts "created_at" DESC, "id" DESC). Without an
  // ORDER BY the UNION's row order is Postgres hash-dedup order, which is
  // nondeterministic - two CSV downloads of the same catalogue could list
  // parents differently, which is what let a Google-Sheet push flatten
  // formulas. UNION already de-duplicates, so no DISTINCT is needed.
  const rows = await prisma.$queryRaw<{ product_id: string }[]>`
    SELECT u."product_id" FROM (
      SELECT "product_id" FROM "svr_variants"
      UNION
      SELECT "product_id" FROM "svr_options"
      UNION
      SELECT "product_id" FROM "svr_addons"
    ) u
    JOIN "shp_products" p ON p."id" = u."product_id"
    ORDER BY p."created_at" DESC, p."id" DESC
  `
  return rows.map((r) => r.product_id)
}
