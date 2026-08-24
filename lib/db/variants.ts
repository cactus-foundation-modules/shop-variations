import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { SvrVariant } from '@/modules/shop-variations/lib/types'

function mapVariant(r: Record<string, unknown>): SvrVariant {
  return {
    id: r.id as string,
    productId: r.product_id as string,
    childProductId: r.child_product_id as string,
    enabled: r.enabled as boolean,
    showImageInGallery: r.show_image_in_gallery as boolean,
    showModelInGallery: r.show_model_in_gallery as boolean,
    galleryPosition: (r.gallery_position as number | null) ?? null,
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
  // The code the supplier wants while this variation is on offer. Sits beside
  // the SKU rather than replacing it - see shop's 018_sale_sku.sql.
  saleSku: string | null
  barcode: string | null
  supplier: string | null
  stockCount: number | null
  // The fewest of this combination sold in one go, null where it simply follows
  // the product's own figure. Carried for the same change-detection reason as
  // the prices above.
  minOrderQuantity: number | null
  weight: number | null
}

export async function getChildProductFields(childProductIds: string[]): Promise<Map<string, ChildProductFields>> {
  const map = new Map<string, ChildProductFields>()
  if (childProductIds.length === 0) return map
  const rows = await prisma.$queryRaw<{ id: string; price: unknown; sale_price: unknown; retail_price: unknown; trade_price: unknown; cost_price: unknown; sku: string | null; sale_sku: string | null; barcode: string | null; supplier: string | null; stock_count: number | null; min_order_quantity: number | null; weight: unknown }[]>`
    SELECT "id", "price", "sale_price", "retail_price", "trade_price", "cost_price", "sku", "sale_sku", "barcode", "supplier", "stock_count", "min_order_quantity", "weight"
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
      saleSku: r.sale_sku ?? null,
      barcode: r.barcode ?? null,
      supplier: r.supplier ?? null,
      stockCount: r.stock_count == null ? null : Number(r.stock_count),
      minOrderQuantity: r.min_order_quantity == null ? null : Number(r.min_order_quantity),
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
// then variant id. Two queries rather than one join, for the reason set out on
// getVariantValueMap below.
export async function getVariantValueMapForProducts(productIds: string[]): Promise<Map<string, Record<string, string[]>>> {
  const map = new Map<string, Record<string, string[]>>()
  if (productIds.length === 0) return map
  const variants = await prisma.$queryRaw<{ id: string; product_id: string }[]>`
    SELECT "id", "product_id" FROM "svr_variants" WHERE "product_id" IN (${Prisma.join(productIds)})
  `
  if (variants.length === 0) return map
  const productByVariant = new Map(variants.map((v) => [v.id, v.product_id]))
  const rows = await getValuesForVariants(variants.map((v) => v.id))
  for (const r of rows) {
    const productId = productByVariant.get(r.variant_id)
    if (!productId) continue
    const perProduct = map.get(productId) ?? {}
    ;(perProduct[r.variant_id] ??= []).push(r.option_value_id)
    map.set(productId, perProduct)
  }
  return map
}

// The value rows for a set of variant ids.
//
// `= ANY($1::text[])` rather than a join back to svr_variants, and that is the
// whole point of this helper existing. Asked as a join - "every value whose
// variant belongs to this product" - Postgres costs the two sides, picks a hash
// join and sequentially scans the ENTIRE svr_variant_values table to find them:
// on a 588-variant desk that is 69,854 rows read to return 2,352, and across the
// live install's life it came to 972 million rows, more than any other table by
// a factor of two. Handed the variant ids directly it uses the (variant_id,
// option_value_id) primary key as a covering index instead - an index-only scan,
// measured at roughly 3ms against 25ms for the join, and the plan holds after
// Postgres switches the prepared statement to a generic plan.
//
// The extra round trip to fetch the ids is real but tiny: svr_variants is
// indexed on product_id and every caller here needs the variant rows anyway.
async function getValuesForVariants(variantIds: string[]): Promise<{ variant_id: string; option_value_id: string }[]> {
  if (variantIds.length === 0) return []
  return prisma.$queryRaw<{ variant_id: string; option_value_id: string }[]>`
    SELECT "variant_id", "option_value_id"
    FROM "svr_variant_values"
    WHERE "variant_id" = ANY(${variantIds}::text[])
  `
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

// child product id -> parent product id for a whole batch of child ids, so the
// cart resolver can map every variant line back to its parent in one query
// rather than a getVariantByChildProductId per line. Ids that are not variant
// children are simply absent from the map.
export async function getVariantParentsByChild(childProductIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const unique = [...new Set(childProductIds)].filter(Boolean)
  if (unique.length === 0) return map
  const rows = await prisma.$queryRaw<{ child_product_id: string; product_id: string }[]>`
    SELECT "child_product_id", "product_id" FROM "svr_variants"
    WHERE "child_product_id" IN (${Prisma.join(unique)})
  `
  for (const r of rows) map.set(r.child_product_id, r.product_id)
  return map
}

// option_value_ids for each variant of a product, keyed by variant id. Two
// queries rather than one join - see getValuesForVariants for why.
export async function getVariantValueMap(productId: string): Promise<Record<string, string[]>> {
  const variants = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "svr_variants" WHERE "product_id" = ${productId}
  `
  const rows = await getValuesForVariants(variants.map((v) => v.id))
  const map: Record<string, string[]> = {}
  for (const r of rows) (map[r.variant_id] ??= []).push(r.option_value_id)
  return map
}

// The EXTRA option values each variant answers to, keyed by variant id - values it
// stands in for without carrying them (see migration 010). Deliberately a separate
// read from getVariantValueMap rather than folded into it: everything that treats a
// variant's value-set as its identity (the CSV round-trip, the sheet pull-diff, the
// deletion planner, upsertVariantForCombination) must go on seeing only the real
// set, or an alias would read as a different combination and be "corrected" away.
// Only the storefront selector payload takes these.
export async function getVariantAliasMap(productId: string): Promise<Record<string, string[]>> {
  const variants = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "svr_variants" WHERE "product_id" = ${productId}
  `
  const variantIds = variants.map((v) => v.id)
  const rows = variantIds.length === 0 ? [] : await prisma.$queryRaw<{ variant_id: string; option_value_id: string }[]>`
    SELECT "variant_id", "option_value_id"
    FROM "svr_variant_option_aliases"
    WHERE "variant_id" = ANY(${variantIds}::text[])
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

// Promote (or demote) this variation's photo, and separately its 3D model, on
// the parent's gallery - see migration 011. Two independent setters rather than
// one taking both fields, matching setVariantEnabled's shape: each is written
// from its own checkbox and neither implies the other.
export async function setVariantShowImageInGallery(id: string, showImageInGallery: boolean): Promise<void> {
  await prisma.$executeRaw`UPDATE "svr_variants" SET "show_image_in_gallery" = ${showImageInGallery} WHERE "id" = ${id}`
}

export async function setVariantShowModelInGallery(id: string, showModelInGallery: boolean): Promise<void> {
  await prisma.$executeRaw`UPDATE "svr_variants" SET "show_model_in_gallery" = ${showModelInGallery} WHERE "id" = ${id}`
}

// Where each promoted variation's photo sits in the parent's gallery - its index
// in the finished strip, the parent's own pictures counted in (migration 016).
// Written as one statement because the Images tab hands back the whole
// arrangement at once, and a loop of single UPDATEs would be a round trip per
// tile every time an image was dragged.
export async function setVariantGalleryPositions(positions: { id: string; galleryPosition: number | null }[]): Promise<void> {
  if (positions.length === 0) return
  const tuples = positions.map((p) => Prisma.sql`(${p.id}::text, ${p.galleryPosition}::int)`)
  await prisma.$executeRaw`
    UPDATE "svr_variants" AS v
    SET "gallery_position" = c.slot
    FROM (VALUES ${Prisma.join(tuples)}) AS c(id, slot)
    WHERE v."id" = c.id
  `
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
