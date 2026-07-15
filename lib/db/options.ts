import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { SvrControlType, SvrOption, SvrOptionValue, SvrOptionWithValues } from '@/modules/shop-variations/lib/types'

function mapOption(r: Record<string, unknown>): SvrOption {
  return {
    id: r.id as string,
    productId: r.product_id as string,
    name: r.name as string,
    controlType: r.control_type as SvrControlType,
    position: r.position as number,
  }
}

function mapValue(r: Record<string, unknown>): SvrOptionValue {
  return {
    id: r.id as string,
    optionId: r.option_id as string,
    label: r.label as string,
    swatch: (r.swatch as string | null) ?? null,
    position: r.position as number,
  }
}

// All options for a parent product with their values, ordered for display.
export async function getOptionsWithValues(productId: string): Promise<SvrOptionWithValues[]> {
  const optionRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_options" WHERE "product_id" = ${productId} ORDER BY "position" ASC, "created_at" ASC
  `
  const options = optionRows.map(mapOption)
  if (options.length === 0) return []
  const valueRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_option_values" WHERE "option_id" IN (${Prisma.join(options.map((o) => o.id))})
    ORDER BY "position" ASC
  `
  const values = valueRows.map(mapValue)
  return options.map((o) => ({ ...o, values: values.filter((v) => v.optionId === o.id) }))
}

export async function createOption(productId: string, name: string, controlType: SvrControlType, position: number): Promise<{ id: string }> {
  const rows = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "svr_options" ("product_id", "name", "control_type", "position")
    VALUES (${productId}, ${name}, ${controlType}, ${position})
    RETURNING "id"
  `
  return rows[0]
}

export async function updateOption(id: string, fields: { name?: string; controlType?: SvrControlType; position?: number }): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (fields.name !== undefined) sets.push(Prisma.sql`"name" = ${fields.name}`)
  if (fields.controlType !== undefined) sets.push(Prisma.sql`"control_type" = ${fields.controlType}`)
  if (fields.position !== undefined) sets.push(Prisma.sql`"position" = ${fields.position}`)
  if (sets.length === 0) return
  await prisma.$executeRaw`UPDATE "svr_options" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
}

export async function deleteOption(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "svr_options" WHERE "id" = ${id}`
}

export async function createOptionValue(optionId: string, label: string, swatch: string | null, position: number): Promise<{ id: string }> {
  const rows = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "svr_option_values" ("option_id", "label", "swatch", "position")
    VALUES (${optionId}, ${label}, ${swatch}, ${position})
    RETURNING "id"
  `
  return rows[0]
}

export async function updateOptionValue(id: string, fields: { label?: string; swatch?: string | null; position?: number }): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (fields.label !== undefined) sets.push(Prisma.sql`"label" = ${fields.label}`)
  if (fields.swatch !== undefined) sets.push(Prisma.sql`"swatch" = ${fields.swatch}`)
  if (fields.position !== undefined) sets.push(Prisma.sql`"position" = ${fields.position}`)
  if (sets.length === 0) return
  await prisma.$executeRaw`UPDATE "svr_option_values" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
}

export async function deleteOptionValue(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "svr_option_values" WHERE "id" = ${id}`
}
