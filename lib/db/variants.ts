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

export async function setVariantEnabled(id: string, enabled: boolean): Promise<void> {
  await prisma.$executeRaw`UPDATE "svr_variants" SET "enabled" = ${enabled} WHERE "id" = ${id}`
}

export async function deleteVariant(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "svr_variants" WHERE "id" = ${id}`
}

// Count of variant-enabled products (for the admin list) - parents that have at
// least one variant row.
export async function getProductIdsWithVariations(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ product_id: string }[]>`
    SELECT DISTINCT "product_id" FROM "svr_variants"
    UNION
    SELECT DISTINCT "product_id" FROM "svr_options"
    UNION
    SELECT DISTINCT "product_id" FROM "svr_addons"
  `
  return rows.map((r) => r.product_id)
}
