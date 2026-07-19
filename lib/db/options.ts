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
    requiresPreviousOption: (r.requires_previous_option as boolean | null) ?? false,
    sourceProvider: (r.source_provider as string | null) ?? null,
    sourceRef: (r.source_ref as string | null) ?? null,
  }
}

function mapValue(r: Record<string, unknown>): SvrOptionValue {
  return {
    id: r.id as string,
    optionId: r.option_id as string,
    label: r.label as string,
    swatch: (r.swatch as string | null) ?? null,
    position: r.position as number,
    sourceRef: (r.source_ref as string | null) ?? null,
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

export async function createOption(
  productId: string,
  name: string,
  controlType: SvrControlType,
  position: number,
  source?: { provider: string; ref: string } | null,
): Promise<{ id: string }> {
  const rows = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "svr_options" ("product_id", "name", "control_type", "position", "source_provider", "source_ref")
    VALUES (${productId}, ${name}, ${controlType}, ${position}, ${source?.provider ?? null}, ${source?.ref ?? null})
    RETURNING "id"
  `
  return rows[0]
}

// A single option with its values, for the refresh path which needs to know what
// it already holds before deciding what to add, rename or leave be.
export async function getOptionWithValues(id: string): Promise<SvrOptionWithValues | null> {
  const optionRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_options" WHERE "id" = ${id} LIMIT 1
  `
  const optionRow = optionRows[0]
  if (!optionRow) return null
  const valueRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_option_values" WHERE "option_id" = ${id} ORDER BY "position" ASC
  `
  return { ...mapOption(optionRow), values: valueRows.map(mapValue) }
}

export async function updateOption(id: string, fields: { name?: string; controlType?: SvrControlType; position?: number; requiresPreviousOption?: boolean }): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (fields.name !== undefined) sets.push(Prisma.sql`"name" = ${fields.name}`)
  if (fields.controlType !== undefined) sets.push(Prisma.sql`"control_type" = ${fields.controlType}`)
  if (fields.position !== undefined) sets.push(Prisma.sql`"position" = ${fields.position}`)
  if (fields.requiresPreviousOption !== undefined) sets.push(Prisma.sql`"requires_previous_option" = ${fields.requiresPreviousOption}`)
  if (sets.length === 0) return
  await prisma.$executeRaw`UPDATE "svr_options" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
}

export async function deleteOption(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "svr_options" WHERE "id" = ${id}`
}

// The parent product an option belongs to. Renames need it to re-sync the
// variant child products afterwards.
export async function getOptionProductId(id: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ product_id: string }[]>`
    SELECT "product_id" FROM "svr_options" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0]?.product_id ?? null
}

// The owning option id and parent product id of a single value.
export async function getOptionValueOwner(id: string): Promise<{ optionId: string; productId: string } | null> {
  const rows = await prisma.$queryRaw<{ option_id: string; product_id: string }[]>`
    SELECT v."option_id", o."product_id"
    FROM "svr_option_values" v
    JOIN "svr_options" o ON o."id" = v."option_id"
    WHERE v."id" = ${id} LIMIT 1
  `
  const row = rows[0]
  return row ? { optionId: row.option_id, productId: row.product_id } : null
}

// Case-insensitive duplicate checks. Two options on a product sharing a name, or
// two values in one option sharing a label, make the generated variant names
// ambiguous, so renames are refused rather than allowed to collide.
export async function optionNameTaken(productId: string, name: string, exceptId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "svr_options"
    WHERE "product_id" = ${productId} AND lower("name") = lower(${name}) AND "id" <> ${exceptId}
    LIMIT 1
  `
  return rows.length > 0
}

export async function optionValueLabelTaken(optionId: string, label: string, exceptId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "svr_option_values"
    WHERE "option_id" = ${optionId} AND lower("label") = lower(${label}) AND "id" <> ${exceptId}
    LIMIT 1
  `
  return rows.length > 0
}

export async function createOptionValue(
  optionId: string,
  label: string,
  swatch: string | null,
  position: number,
  sourceRef?: string | null,
): Promise<{ id: string }> {
  const rows = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "svr_option_values" ("option_id", "label", "swatch", "position", "source_ref")
    VALUES (${optionId}, ${label}, ${swatch}, ${position}, ${sourceRef ?? null})
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
