import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { SvrAddon, SvrAddonConfig, SvrAddonType } from '@/modules/shop-variations/lib/types'

function mapAddon(r: Record<string, unknown>): SvrAddon {
  return {
    id: r.id as string,
    productId: r.product_id as string,
    type: r.type as SvrAddonType,
    label: r.label as string,
    required: r.required as boolean,
    position: r.position as number,
    // jsonb comes back already parsed
    config: (r.config as SvrAddonConfig | null) ?? {},
  }
}

export async function getAddonById(id: string): Promise<SvrAddon | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "svr_addons" WHERE "id" = ${id} LIMIT 1`
  return rows[0] ? mapAddon(rows[0]) : null
}

export async function getAddons(productId: string): Promise<SvrAddon[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_addons" WHERE "product_id" = ${productId} ORDER BY "position" ASC, "created_at" ASC
  `
  return rows.map(mapAddon)
}

// Same as getAddons, for every product in one go - one query instead of one per
// product. Used where a caller needs several parents' worth at once (a Pull's
// preview/deletion planner), which used to call the per-product version in a loop.
export async function getAddonsForProducts(productIds: string[]): Promise<Map<string, SvrAddon[]>> {
  const map = new Map<string, SvrAddon[]>()
  if (productIds.length === 0) return map
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_addons" WHERE "product_id" IN (${Prisma.join(productIds)}) ORDER BY "position" ASC, "created_at" ASC
  `
  for (const r of rows) {
    const a = mapAddon(r)
    const list = map.get(a.productId) ?? []
    list.push(a)
    map.set(a.productId, list)
  }
  return map
}

export async function createAddon(
  productId: string,
  data: { type: SvrAddonType; label: string; required: boolean; position: number; config: SvrAddonConfig },
): Promise<{ id: string }> {
  const rows = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "svr_addons" ("product_id", "type", "label", "required", "position", "config")
    VALUES (${productId}, ${data.type}, ${data.label}, ${data.required}, ${data.position}, ${JSON.stringify(data.config)}::jsonb)
    RETURNING "id"
  `
  return rows[0]
}

export async function updateAddon(
  id: string,
  fields: Partial<{ label: string; required: boolean; position: number; config: SvrAddonConfig; type: SvrAddonType }>,
): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (fields.type !== undefined) sets.push(Prisma.sql`"type" = ${fields.type}`)
  if (fields.label !== undefined) sets.push(Prisma.sql`"label" = ${fields.label}`)
  if (fields.required !== undefined) sets.push(Prisma.sql`"required" = ${fields.required}`)
  if (fields.position !== undefined) sets.push(Prisma.sql`"position" = ${fields.position}`)
  if (fields.config !== undefined) sets.push(Prisma.sql`"config" = ${JSON.stringify(fields.config)}::jsonb`)
  if (sets.length === 0) return
  await prisma.$executeRaw`UPDATE "svr_addons" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
}

export async function deleteAddon(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "svr_addons" WHERE "id" = ${id}`
}
