// Orchestration that spans shop-variations' own tables and the shop module's
// product functions. Concrete variants are ordinary hidden shp_products rows;
// this layer creates/removes them through shop's createProduct/deleteProduct so
// inventory, checkout and refunds keep working with no shop changes.
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { createProduct, updateProduct, deleteProduct, getProductById, getProductBySlug, getProductMedia } from '@/modules/shop/lib/db/products'
import { slugify, ensureUniqueProductSlug } from '@/modules/shop/lib/slug'
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { getVariants, getVariantValueMap, createVariant } from '@/modules/shop-variations/lib/db/variants'
import { getAddons } from '@/modules/shop-variations/lib/db/addons'
import { getSettings } from '@/modules/shop-variations/lib/db/settings'
import type { SvrAddon, SvrOptionWithValues, VariantSelectorPayload, VariantSelectorVariant } from '@/modules/shop-variations/lib/types'

// Stable key for a combination: its option-value ids, sorted, joined. Two
// combinations are the same variant iff they have the same set of values.
function comboKey(optionValueIds: string[]): string {
  return [...optionValueIds].sort().join('|')
}

function cartesian(arrays: string[][]): string[][] {
  return arrays.reduce<string[][]>((acc, arr) => acc.flatMap((combo) => arr.map((v) => [...combo, v])), [[]])
}

export type GenerateMatrixResult = { created: number; removed: number; total: number }

// (Re)build the variant matrix for a parent product. Existing variants whose
// exact value-set still appears are preserved (keeping their per-variant price,
// stock, etc.); combinations no longer possible are removed along with their
// child product; genuinely new combinations get a fresh hidden child product.
export async function generateMatrix(parentId: string): Promise<GenerateMatrixResult> {
  const parent = await getProductById(parentId)
  if (!parent) throw new Error('Product not found')
  if (parent.catalogueHidden) throw new Error('Cannot add variations to a variant child product')

  const options = (await getOptionsWithValues(parentId)).filter((o) => o.values.length > 0)
  const settings = await getSettings()

  // The full cartesian product of one value per option.
  const valueMatrix = cartesian(options.map((o) => o.values.map((v) => v.id)))
  // An empty options set yields [[]] - treat as "no matrix".
  const combos = options.length === 0 ? [] : valueMatrix
  if (combos.length > settings.maxVariants) {
    throw new Error(`This combination would create ${combos.length} variants, above the limit of ${settings.maxVariants}. Reduce the options or raise the limit in settings.`)
  }

  const valueLabel = new Map<string, string>()
  for (const o of options) for (const v of o.values) valueLabel.set(v.id, v.label)

  const existing = await getVariants(parentId)
  const existingValues = await getVariantValueMap(parentId)
  const existingByKey = new Map<string, string>() // comboKey -> variantId
  for (const v of existing) existingByKey.set(comboKey(existingValues[v.id] ?? []), v.id)

  const wantedKeys = new Set(combos.map((c) => comboKey(c)))

  let created = 0
  let position = existing.length
  for (const combo of combos) {
    const key = comboKey(combo)
    if (existingByKey.has(key)) continue
    // Compose the child in the option order the admin defined.
    const labels = options.map((o) => {
      const chosen = combo.find((id) => o.values.some((v) => v.id === id))
      return chosen ? valueLabel.get(chosen) : undefined
    }).filter(Boolean)
    const name = `${parent.name} - ${labels.join(' / ')}`
    const slug = await ensureUniqueProductSlug(slugify(name))
    const child = await createProduct({
      name,
      slug,
      type: parent.type,
      status: 'ACTIVE',
      description: null,
      price: Number(parent.price),
      taxClassId: parent.taxClassId,
      trackInventory: parent.trackInventory,
      stockCount: parent.trackInventory ? 0 : null,
      outOfStockBehaviour: parent.outOfStockBehaviour,
      weight: parent.weight != null ? Number(parent.weight) : null,
      catalogueHidden: true,
    })
    await createVariant(parentId, child.id, combo, position)
    position += 1
    created += 1
  }

  // Remove variants whose combination is no longer possible; deleting the child
  // product cascades the svr_variants + svr_variant_values rows away.
  let removed = 0
  for (const v of existing) {
    const key = comboKey(existingValues[v.id] ?? [])
    if (!wantedKeys.has(key)) {
      await deleteProduct(v.childProductId)
      removed += 1
    }
  }

  return { created, removed, total: combos.length }
}

// Delete every variant + child product for a parent (used when clearing the
// matrix). Options/add-ons are left in place unless separately removed.
export async function clearVariants(parentId: string): Promise<number> {
  const existing = await getVariants(parentId)
  for (const v of existing) await deleteProduct(v.childProductId)
  return existing.length
}

type ChildRow = {
  id: string
  price: unknown
  track_inventory: boolean
  stock_count: number | null
  out_of_stock_behaviour: string
  is_pre_order: boolean
  sku: string | null
}

// Everything the storefront selector needs in one payload: option controls,
// each variant's child price/stock/image, and the personalisation add-ons.
export async function getVariantSelectorPayload(parentId: string): Promise<VariantSelectorPayload | null> {
  const parent = await getProductById(parentId)
  if (!parent) return null

  const [options, variants, valueMap, addons, baseMedia] = await Promise.all([
    getOptionsWithValues(parentId),
    getVariants(parentId),
    getVariantValueMap(parentId),
    getAddons(parentId),
    getProductMedia(parentId),
  ])

  const childIds = variants.map((v) => v.childProductId)
  const childById = new Map<string, ChildRow>()
  const imageByChild = new Map<string, string>()
  if (childIds.length > 0) {
    const childRows = await prisma.$queryRaw<ChildRow[]>`
      SELECT "id", "price", "track_inventory", "stock_count", "out_of_stock_behaviour", "is_pre_order", "sku"
      FROM "shp_products" WHERE "id" IN (${Prisma.join(childIds)})
    `
    for (const r of childRows) childById.set(r.id, r)
    const mediaRows = await prisma.$queryRaw<{ product_id: string; url: string }[]>`
      SELECT DISTINCT ON ("product_id") "product_id", "url"
      FROM "shp_product_media" WHERE "product_id" IN (${Prisma.join(childIds)})
      ORDER BY "product_id", "is_primary" DESC, "position" ASC
    `
    for (const r of mediaRows) imageByChild.set(r.product_id, r.url)
  }

  const selectorVariants: VariantSelectorVariant[] = variants.map((v) => {
    const child = childById.get(v.childProductId)
    const stockCount = child?.stock_count ?? null
    const tracks = child?.track_inventory ?? false
    const inStock = !tracks || (stockCount ?? 0) > 0 || child?.out_of_stock_behaviour === 'BACKORDER' || child?.is_pre_order === true
    return {
      id: v.id,
      childProductId: v.childProductId,
      optionValueIds: valueMap[v.id] ?? [],
      enabled: v.enabled,
      price: child ? Number(child.price) : Number(parent.price),
      inStock,
      stockCount: tracks ? stockCount : null,
      imageUrl: imageByChild.get(v.childProductId) ?? null,
      sku: child?.sku ?? null,
    }
  })

  return {
    productId: parentId,
    productName: parent.name,
    basePrice: Number(parent.price),
    baseImages: baseMedia.filter((m) => m.type === 'IMAGE').map((m) => ({ url: m.url, alt: m.altText ?? parent.name })),
    options,
    variants: selectorVariants,
    addons,
  }
}

// Slug-based storefront lookup: the product page knows the slug (from its URL),
// not the id, and variations keeps zero product-context injection in shop.
export async function getVariantSelectorPayloadBySlug(slug: string): Promise<VariantSelectorPayload | null> {
  const product = await getProductBySlug(slug)
  if (!product || product.catalogueHidden) return null
  return getVariantSelectorPayload(product.id)
}

export type VariationsSummary = {
  optionCount: number
  optionNames: string[]
  variantCount: number
  enabledVariantCount: number
  aggregateStock: number | null
  addonCount: number
}

// Compact figures for the inline product-editor section. One light pass; the
// aggregate stock only counts children that actually track inventory (null when
// none do).
export async function getVariationsSummary(parentId: string): Promise<VariationsSummary> {
  const [options, variants, addons] = await Promise.all([
    getOptionsWithValues(parentId),
    getVariants(parentId),
    getAddons(parentId),
  ])
  let aggregateStock: number | null = null
  if (variants.length > 0) {
    const rows = await prisma.$queryRaw<{ total: number | null; tracked: bigint }[]>`
      SELECT COALESCE(SUM("stock_count"), 0)::int AS total,
             COUNT(*) FILTER (WHERE "track_inventory" = true)::bigint AS tracked
      FROM "shp_products" WHERE "id" IN (${Prisma.join(variants.map((v) => v.childProductId))}) AND "track_inventory" = true
    `
    aggregateStock = Number(rows[0]?.tracked ?? 0) > 0 ? Number(rows[0]?.total ?? 0) : null
  }
  return {
    optionCount: options.length,
    optionNames: options.map((o) => o.name),
    variantCount: variants.length,
    enabledVariantCount: variants.filter((v) => v.enabled).length,
    aggregateStock,
    addonCount: addons.length,
  }
}

// Admin bulk-grid row: the full editable per-variant fields (which live on the
// child product) plus a human label composed from the option values.
export type VariantEditorRow = {
  variantId: string
  childProductId: string
  optionValueIds: string[]
  label: string
  enabled: boolean
  price: number
  sku: string | null
  barcode: string | null
  trackInventory: boolean
  stockCount: number | null
  weight: number | null
  imageUrl: string | null
}

export type EditorPayload = {
  product: { id: string; name: string; slug: string; price: number }
  options: SvrOptionWithValues[]
  variants: VariantEditorRow[]
  addons: SvrAddon[]
}

type ChildEditRow = ChildRow & { barcode: string | null; weight: unknown }

// Everything the deep-dive editor renders: options + values, the bulk grid rows
// with full child fields, and the personalisation add-ons.
export async function getEditorPayload(parentId: string): Promise<EditorPayload | null> {
  const parent = await getProductById(parentId)
  if (!parent) return null

  const [options, variants, valueMap, addons] = await Promise.all([
    getOptionsWithValues(parentId),
    getVariants(parentId),
    getVariantValueMap(parentId),
    getAddons(parentId),
  ])

  const labelByValueId = new Map<string, string>()
  const valueOptionOrder = new Map<string, number>()
  options.forEach((o, oi) => o.values.forEach((v) => { labelByValueId.set(v.id, v.label); valueOptionOrder.set(v.id, oi) }))

  const childIds = variants.map((v) => v.childProductId)
  const childById = new Map<string, ChildEditRow>()
  const imageByChild = new Map<string, string>()
  if (childIds.length > 0) {
    const childRows = await prisma.$queryRaw<ChildEditRow[]>`
      SELECT "id", "price", "sku", "barcode", "track_inventory", "stock_count", "out_of_stock_behaviour", "is_pre_order", "weight"
      FROM "shp_products" WHERE "id" IN (${Prisma.join(childIds)})
    `
    for (const r of childRows) childById.set(r.id, r)
    const mediaRows = await prisma.$queryRaw<{ product_id: string; url: string }[]>`
      SELECT DISTINCT ON ("product_id") "product_id", "url"
      FROM "shp_product_media" WHERE "product_id" IN (${Prisma.join(childIds)})
      ORDER BY "product_id", "is_primary" DESC, "position" ASC
    `
    for (const r of mediaRows) imageByChild.set(r.product_id, r.url)
  }

  const rows: VariantEditorRow[] = variants.map((v) => {
    const child = childById.get(v.childProductId)
    const ids = (valueMap[v.id] ?? []).slice().sort((a, b) => (valueOptionOrder.get(a) ?? 0) - (valueOptionOrder.get(b) ?? 0))
    const label = ids.map((id) => labelByValueId.get(id)).filter(Boolean).join(' / ')
    return {
      variantId: v.id,
      childProductId: v.childProductId,
      optionValueIds: valueMap[v.id] ?? [],
      label,
      enabled: v.enabled,
      price: child ? Number(child.price) : Number(parent.price),
      sku: child?.sku ?? null,
      barcode: child?.barcode ?? null,
      trackInventory: child?.track_inventory ?? false,
      stockCount: child?.stock_count ?? null,
      weight: child?.weight != null ? Number(child.weight) : null,
      imageUrl: imageByChild.get(v.childProductId) ?? null,
    }
  })

  return {
    product: { id: parent.id, name: parent.name, slug: parent.slug, price: Number(parent.price) },
    options,
    variants: rows,
    addons,
  }
}

// Create or update the single variant for a specific value combination (used by
// CSV import). Existing variants are matched by their exact value-set, so a
// re-import updates in place rather than duplicating.
export async function upsertVariantForCombination(
  parentId: string,
  optionValueIds: string[],
  valueLabels: string[],
  fields: { price?: number; sku?: string | null; barcode?: string | null; stockCount?: number | null; weight?: number | null },
): Promise<{ variantId: string; created: boolean }> {
  const parent = await getProductById(parentId)
  if (!parent) throw new Error('Parent not found')

  const existing = await getVariants(parentId)
  const valueMap = await getVariantValueMap(parentId)
  const key = comboKey(optionValueIds)
  const match = existing.find((v) => comboKey(valueMap[v.id] ?? []) === key)

  let childId: string
  let variantId: string
  let created = false
  if (match) {
    childId = match.childProductId
    variantId = match.id
  } else {
    const name = `${parent.name} - ${valueLabels.join(' / ')}`
    const slug = await ensureUniqueProductSlug(slugify(name))
    const child = await createProduct({
      name, slug, type: parent.type, status: 'ACTIVE', price: fields.price ?? Number(parent.price),
      taxClassId: parent.taxClassId, trackInventory: parent.trackInventory,
      stockCount: parent.trackInventory ? fields.stockCount ?? 0 : null,
      outOfStockBehaviour: parent.outOfStockBehaviour, catalogueHidden: true,
    })
    const cv = await createVariant(parentId, child.id, optionValueIds, existing.length)
    childId = child.id
    variantId = cv.id
    created = true
  }

  await updateProduct(childId, {
    ...(fields.price !== undefined ? { price: fields.price } : {}),
    ...(fields.sku !== undefined ? { sku: fields.sku } : {}),
    ...(fields.barcode !== undefined ? { barcode: fields.barcode } : {}),
    ...(fields.stockCount !== undefined ? { stockCount: fields.stockCount, trackInventory: fields.stockCount != null } : {}),
    ...(fields.weight !== undefined ? { weight: fields.weight } : {}),
  })
  return { variantId, created }
}
