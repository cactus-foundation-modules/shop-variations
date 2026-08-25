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
    nameOverridden: (r.name_overridden as boolean | null) ?? false,
    cardDisplay: (r.card_display as boolean | null) ?? false,
    cardLabel: (r.card_label as string | null) ?? null,
    cardLimit: (r.card_limit as number | null) ?? null,
    cardFitLines: (r.card_fit_lines as number | null) ?? null,
  }
}

function mapValue(r: Record<string, unknown>): SvrOptionValue {
  return {
    id: r.id as string,
    optionId: r.option_id as string,
    label: r.label as string,
    slug: r.slug as string,
    swatch: (r.swatch as string | null) ?? null,
    swatchSmall: (r.swatch_small as string | null) ?? null,
    swatchTiny: (r.swatch_tiny as string | null) ?? null,
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

// Same as getOptionsWithValues, for every product in one go - two queries total
// instead of two per product. Used where a caller needs several parents' worth
// at once (a Pull's preview/deletion planner), which used to call the per-product
// version in a loop.
export async function getOptionsWithValuesForProducts(productIds: string[]): Promise<Map<string, SvrOptionWithValues[]>> {
  const map = new Map<string, SvrOptionWithValues[]>()
  if (productIds.length === 0) return map
  const optionRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_options" WHERE "product_id" IN (${Prisma.join(productIds)}) ORDER BY "position" ASC, "created_at" ASC
  `
  const options = optionRows.map(mapOption)
  if (options.length === 0) return map
  const valueRows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_option_values" WHERE "option_id" IN (${Prisma.join(options.map((o) => o.id))})
    ORDER BY "position" ASC
  `
  const values = valueRows.map(mapValue)
  const valuesByOption = new Map<string, SvrOptionValue[]>()
  for (const v of values) {
    const list = valuesByOption.get(v.optionId) ?? []
    list.push(v)
    valuesByOption.set(v.optionId, list)
  }
  for (const o of options) {
    const list = map.get(o.productId) ?? []
    list.push({ ...o, values: valuesByOption.get(o.id) ?? [] })
    map.set(o.productId, list)
  }
  return map
}

export async function createOption(
  productId: string,
  name: string,
  controlType: SvrControlType,
  position: number,
  source?: { provider: string; ref: string } | null,
  nameOverridden = false,
): Promise<{ id: string }> {
  const rows = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "svr_options" ("product_id", "name", "control_type", "position", "source_provider", "source_ref", "name_overridden")
    VALUES (${productId}, ${name}, ${controlType}, ${position}, ${source?.provider ?? null}, ${source?.ref ?? null}, ${nameOverridden})
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

// `cardLabel`, `cardLimit` and `cardFitLines` are nullable columns, so undefined
// (leave alone) and null (clear it) mean different things here and must stay
// distinguishable.
export async function updateOption(id: string, fields: { name?: string; controlType?: SvrControlType; position?: number; requiresPreviousOption?: boolean; nameOverridden?: boolean; cardDisplay?: boolean; cardLabel?: string | null; cardLimit?: number | null; cardFitLines?: number | null }): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (fields.name !== undefined) sets.push(Prisma.sql`"name" = ${fields.name}`)
  if (fields.nameOverridden !== undefined) sets.push(Prisma.sql`"name_overridden" = ${fields.nameOverridden}`)
  if (fields.controlType !== undefined) sets.push(Prisma.sql`"control_type" = ${fields.controlType}`)
  if (fields.position !== undefined) sets.push(Prisma.sql`"position" = ${fields.position}`)
  if (fields.requiresPreviousOption !== undefined) sets.push(Prisma.sql`"requires_previous_option" = ${fields.requiresPreviousOption}`)
  if (fields.cardDisplay !== undefined) sets.push(Prisma.sql`"card_display" = ${fields.cardDisplay}`)
  if (fields.cardLabel !== undefined) sets.push(Prisma.sql`"card_label" = ${fields.cardLabel}`)
  if (fields.cardLimit !== undefined) sets.push(Prisma.sql`"card_limit" = ${fields.cardLimit}`)
  if (fields.cardFitLines !== undefined) sets.push(Prisma.sql`"card_fit_lines" = ${fields.cardFitLines}`)
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

// Case-insensitive duplicate check. Two options on a product sharing a name make
// the spreadsheet importer's option matching (and the product page) ambiguous,
// so renames are refused rather than allowed to collide. Value LABELS carry no
// such check any more: two values may read "Black" as long as their slugs differ
// - the slug, not the label, is a value's identity within its option.
export async function optionNameTaken(productId: string, name: string, exceptId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "svr_options"
    WHERE "product_id" = ${productId} AND lower("name") = lower(${name}) AND "id" <> ${exceptId}
    LIMIT 1
  `
  return rows.length > 0
}

// The value on an option holding a slug, if any. Slugs are unique per option, so
// this is the lookup the importer resolves "(slug)Label" cells with.
export async function findOptionValueBySlug(optionId: string, slug: string): Promise<SvrOptionValue | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_option_values" WHERE "option_id" = ${optionId} AND "slug" = ${slug} LIMIT 1
  `
  return rows[0] ? mapValue(rows[0]) : null
}

// First free spelling of `base` on the option: "black", then "black-2", "black-3".
// Same convention every other slug on the platform follows.
export async function ensureUniqueOptionValueSlug(optionId: string, base: string, exceptId?: string): Promise<string> {
  let slug = base
  for (let n = 2; ; n++) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "svr_option_values"
      WHERE "option_id" = ${optionId} AND "slug" = ${slug} AND "id" <> ${exceptId ?? ''} LIMIT 1
    `
    if (rows.length === 0) return slug
    slug = `${base}-${n}`
  }
}

export async function createOptionValue(
  optionId: string,
  label: string,
  slug: string,
  swatch: string | null,
  position: number,
  sourceRef?: string | null,
  swatchSmall?: string | null,
  swatchTiny?: string | null,
): Promise<{ id: string }> {
  const rows = await prisma.$queryRaw<[{ id: string }]>`
    INSERT INTO "svr_option_values" ("option_id", "label", "slug", "swatch", "swatch_small", "swatch_tiny", "position", "source_ref")
    VALUES (${optionId}, ${label}, ${slug}, ${swatch}, ${swatchSmall ?? null}, ${swatchTiny ?? null}, ${position}, ${sourceRef ?? null})
    RETURNING "id"
  `
  return rows[0]
}

export async function updateOptionValue(
  id: string,
  fields: { label?: string; slug?: string; swatch?: string | null; swatchSmall?: string | null; swatchTiny?: string | null; position?: number; sourceRef?: string | null },
): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (fields.label !== undefined) sets.push(Prisma.sql`"label" = ${fields.label}`)
  if (fields.slug !== undefined) sets.push(Prisma.sql`"slug" = ${fields.slug}`)
  if (fields.swatch !== undefined) sets.push(Prisma.sql`"swatch" = ${fields.swatch}`)
  // Null clears a copy whose original has been replaced by hand - a stale
  // rendition of the OLD picture is worse than falling back to the new one.
  if (fields.swatchSmall !== undefined) sets.push(Prisma.sql`"swatch_small" = ${fields.swatchSmall}`)
  if (fields.swatchTiny !== undefined) sets.push(Prisma.sql`"swatch_tiny" = ${fields.swatchTiny}`)
  if (fields.position !== undefined) sets.push(Prisma.sql`"position" = ${fields.position}`)
  // Which source value this copy answers to. Moved when a rename makes it a
  // different one of the source's values - see rename-repoint.ts.
  if (fields.sourceRef !== undefined) sets.push(Prisma.sql`"source_ref" = ${fields.sourceRef}`)
  if (sets.length === 0) return
  await prisma.$executeRaw`UPDATE "svr_option_values" SET ${Prisma.join(sets, ', ')} WHERE "id" = ${id}`
}

export async function deleteOptionValue(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "svr_option_values" WHERE "id" = ${id}`
}
