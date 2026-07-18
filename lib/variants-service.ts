// Orchestration that spans shop-variations' own tables and the shop module's
// product functions. Concrete variants are ordinary hidden shp_products rows;
// this layer creates/removes them through shop's createProduct/deleteProduct so
// inventory, checkout and refunds keep working with no shop changes.
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { createProduct, updateProduct, deleteProduct, getProductById, getProductBySlug, getProductMedia } from '@/modules/shop/lib/db/products'
import { slugify, ensureUniqueProductSlug } from '@/modules/shop/lib/slug'
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { getVariants, getVariantValueMap, createVariant, setVariantPositions, type ChildProductFields } from '@/modules/shop-variations/lib/db/variants'
import { getAddons } from '@/modules/shop-variations/lib/db/addons'
import type { SvrAddon, SvrOptionWithValues, VariantSelectorPayload, VariantSelectorVariant } from '@/modules/shop-variations/lib/types'

// Stable key for a combination: its option-value ids, sorted, joined. Two
// combinations are the same variant iff they have the same set of values.
function comboKey(optionValueIds: string[]): string {
  return [...optionValueIds].sort().join('|')
}

function cartesian(arrays: string[][]): string[][] {
  return arrays.reduce<string[][]>((acc, arr) => acc.flatMap((combo) => arr.map((v) => [...combo, v])), [[]])
}

export type GenerateMatrixResult = { created: number; removed: number; total: number; done: boolean }

// Each variant is a real child product built one round-trip at a time, so a big
// matrix (hundreds of combinations) cannot finish inside a single serverless
// invocation before it is killed - a half-built matrix and stray child products
// were the result. So generation works to a time budget: it builds what it can
// in the time it has, reports whether it finished, and the caller calls again to
// pick up where it left off (resumption is a cheap in-memory skip of what already
// exists). The budget sits well under the route's 60s ceiling so the request
// always returns cleanly rather than timing out mid-combo.
const MATRIX_BATCH_MS = 30_000

// (Re)build the variant matrix for a parent product. Existing variants whose
// exact value-set still appears are preserved (keeping their per-variant price,
// stock, etc.); combinations no longer possible are removed along with their
// child product; genuinely new combinations get a fresh hidden child product.
// Returns done: false when the time budget ran out with work still to do - call
// again to continue.
export async function generateMatrix(parentId: string): Promise<GenerateMatrixResult> {
  const startedAt = Date.now()
  const parent = await getProductById(parentId)
  if (!parent) throw new Error('Product not found')
  if (parent.catalogueHidden) throw new Error('Cannot add variations to a variant child product')

  const options = (await getOptionsWithValues(parentId)).filter((o) => o.values.length > 0)

  // The full cartesian product of one value per option.
  const valueMatrix = cartesian(options.map((o) => o.values.map((v) => v.id)))
  // An empty options set yields [[]] - treat as "no matrix".
  const combos = options.length === 0 ? [] : valueMatrix

  const valueLabel = new Map<string, string>()
  for (const o of options) for (const v of o.values) valueLabel.set(v.id, v.label)

  const existing = await getVariants(parentId)
  const existingValues = await getVariantValueMap(parentId)
  const existingByKey = new Map<string, string>() // comboKey -> variantId
  for (const v of existing) existingByKey.set(comboKey(existingValues[v.id] ?? []), v.id)

  const wantedKeys = new Set(combos.map((c) => comboKey(c)))

  let created = 0
  let hitBudget = false
  let position = existing.length
  for (const combo of combos) {
    const key = comboKey(combo)
    if (existingByKey.has(key)) continue
    // Only actual creation work counts against the budget; skipping combinations
    // that already exist is an in-memory no-op, so resuming a part-built matrix
    // spends its whole budget on the combinations still missing. Checked before
    // creating, and only between combos, so a combo is never left half-made
    // (a child product without its variant row).
    if (Date.now() - startedAt > MATRIX_BATCH_MS) { hitBudget = true; break }
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
  // product cascades the svr_variants + svr_variant_values rows away. Held back
  // until the creation phase has finished so a resumed build fills the gaps
  // before it starts pruning, and budgeted the same way so a large prune cannot
  // overrun the request either.
  let removed = 0
  if (!hitBudget) {
    for (const v of existing) {
      if (Date.now() - startedAt > MATRIX_BATCH_MS) { hitBudget = true; break }
      const key = comboKey(existingValues[v.id] ?? [])
      if (!wantedKeys.has(key)) {
        await deleteProduct(v.childProductId)
        removed += 1
      }
    }
  }

  // total is the count that exists now, not the matrix's eventual size, so the
  // caller can show honest progress while a big build is still catching up.
  return { created, removed, total: existing.length + created - removed, done: !hitBudget }
}

// Put every variant of a parent back into the order the full matrix would build
// them in. generateMatrix walks the options in display order, last option moving
// fastest - so each combination has one canonical slot, the way the digits of an
// odometer do. We recompute that slot for every variant and renumber positions to
// match, which is why an individually-created variant lands exactly where an
// auto-generated matrix would have placed it rather than on the end.
export async function resequenceVariantPositions(parentId: string): Promise<void> {
  const options = (await getOptionsWithValues(parentId)).filter((o) => o.values.length > 0)
  const variants = await getVariants(parentId)
  if (variants.length === 0) return
  const valueMap = await getVariantValueMap(parentId)

  // valueId -> its option's display index and the value's index within that option.
  const coord = new Map<string, { oi: number; vi: number }>()
  options.forEach((o, oi) => o.values.forEach((v, vi) => coord.set(v.id, { oi, vi })))

  // Each option's place value = the product of the value-counts of every option
  // after it, so the last option counts in ones and the first in the largest step.
  const counts = options.map((o) => o.values.length)
  const radix: number[] = []
  let step = 1
  for (let i = counts.length - 1; i >= 0; i -= 1) {
    radix[i] = step
    step *= counts[i] ?? 1
  }

  const canonicalIndex = (variantId: string): number => {
    let idx = 0
    for (const vid of valueMap[variantId] ?? []) {
      const c = coord.get(vid)
      if (c) idx += c.vi * (radix[c.oi] ?? 0)
    }
    return idx
  }

  // getVariants already comes back in current display order, so the incoming index
  // is a stable tie-break for any two variants that map to the same slot (an
  // orphaned value left by a since-changed option, say) rather than a reshuffle.
  const ordered = variants
    .map((v, tie) => ({ id: v.id, idx: canonicalIndex(v.id), tie }))
    .sort((a, b) => a.idx - b.idx || a.tie - b.tie)

  await setVariantPositions(ordered.map((o, position) => ({ id: o.id, position })))
}

// Create one variant for a single hand-picked combination (the admin's "add a
// variant" control), as opposed to generateMatrix building the whole cartesian
// product at once. The combination must name exactly one value for every option
// that has values - a partial combination is not a cell the matrix would ever
// build - and must not already exist. The new variant is a hidden child product
// like any other, then resequenceVariantPositions drops it into matrix order.
export async function createSingleVariant(parentId: string, optionValueIds: string[]): Promise<{ variantId: string }> {
  const parent = await getProductById(parentId)
  if (!parent) throw new Error('Product not found')
  if (parent.catalogueHidden) throw new Error('Cannot add variations to a variant child product')

  const options = (await getOptionsWithValues(parentId)).filter((o) => o.values.length > 0)
  if (options.length === 0) throw new Error('Add an option with at least one value first')

  const valueToOption = new Map<string, string>()
  const labelByValueId = new Map<string, string>()
  for (const o of options) for (const v of o.values) { valueToOption.set(v.id, o.id); labelByValueId.set(v.id, v.label) }

  // One value per option, every option covered - anything else is not a matrix cell.
  const chosenByOption = new Map<string, string>()
  for (const vid of optionValueIds) {
    const optId = valueToOption.get(vid)
    if (!optId) throw new Error('That option value does not belong to this product')
    if (chosenByOption.has(optId)) throw new Error('Choose only one value per option')
    chosenByOption.set(optId, vid)
  }
  if (chosenByOption.size !== options.length) throw new Error('Choose one value for every option')

  // Compose the combination in option (display) order, matching generateMatrix.
  const combo = options.map((o) => chosenByOption.get(o.id) as string)
  const key = comboKey(combo)

  const existing = await getVariants(parentId)
  const existingValues = await getVariantValueMap(parentId)
  if (existing.some((v) => comboKey(existingValues[v.id] ?? []) === key)) {
    throw new Error('That combination already exists')
  }

  const labels = combo.map((id) => labelByValueId.get(id)).filter(Boolean)
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
  const created = await createVariant(parentId, child.id, combo, existing.length)
  await resequenceVariantPositions(parentId)
  return { variantId: created.id }
}

// Re-compose every variant child product's name from the current option value
// labels. Child names are snapshotted at generate time, so a value rename leaves
// them stale until this runs. Slugs are deliberately left alone: they are already
// live urls, and the children are catalogue-hidden anyway. Placed orders keep the
// name they snapshotted, which is the point of that snapshot.
export async function syncVariantChildNames(parentId: string): Promise<number> {
  const parent = await getProductById(parentId)
  if (!parent) return 0

  const options = await getOptionsWithValues(parentId)
  const labelByValueId = new Map<string, string>()
  const optionOrderByValueId = new Map<string, number>()
  options.forEach((o, oi) => o.values.forEach((v) => {
    labelByValueId.set(v.id, v.label)
    optionOrderByValueId.set(v.id, oi)
  }))

  const variants = await getVariants(parentId)
  if (variants.length === 0) return 0
  const valueMap = await getVariantValueMap(parentId)

  const currentNames = new Map<string, string>()
  const childRows = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT "id", "name" FROM "shp_products" WHERE "id" IN (${Prisma.join(variants.map((v) => v.childProductId))})
  `
  for (const r of childRows) currentNames.set(r.id, r.name)

  let renamed = 0
  for (const variant of variants) {
    const ids = (valueMap[variant.id] ?? []).slice()
      .sort((a, b) => (optionOrderByValueId.get(a) ?? 0) - (optionOrderByValueId.get(b) ?? 0))
    const labels = ids.map((id) => labelByValueId.get(id)).filter(Boolean)
    if (labels.length === 0) continue
    const name = `${parent.name} - ${labels.join(' / ')}`
    if (currentNames.get(variant.childProductId) === name) continue
    await updateProduct(variant.childProductId, { name })
    renamed += 1
  }
  return renamed
}

// Delete every variant + child product for a parent (used when clearing the
// matrix). Options/add-ons are left in place unless separately removed.
export async function clearVariants(parentId: string): Promise<number> {
  const existing = await getVariants(parentId)
  for (const v of existing) await deleteProduct(v.childProductId)
  return existing.length
}

// Delete a chosen set of variants (the admin's bulk-select on the grid). Each id
// is checked against this parent's own variants before anything is removed, so a
// stray or already-deleted id is skipped rather than reaching across to another
// product - the same deleteProduct cascade the single-row delete takes. Returns
// how many were actually removed.
export async function deleteVariants(parentId: string, variantIds: string[]): Promise<number> {
  if (variantIds.length === 0) return 0
  const own = new Map((await getVariants(parentId)).map((v) => [v.id, v]))
  let removed = 0
  for (const id of variantIds) {
    const v = own.get(id)
    if (!v) continue
    await deleteProduct(v.childProductId)
    removed += 1
  }
  return removed
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
// A parent's variants + value-set map, pre-loaded once so a bulk caller (the CSV
// importer) can upsert many combinations without re-reading every sibling variant
// per row. Pass it and upsertVariantForCombination keeps it in step as it creates,
// turning an O(rows x variants) import into O(rows).
export type VariantUpsertContext = {
  parent: NonNullable<Awaited<ReturnType<typeof getProductById>>>
  existing: Awaited<ReturnType<typeof getVariants>>
  valueMap: Awaited<ReturnType<typeof getVariantValueMap>>
  // Every existing child's current fields, pre-loaded once. When present, change
  // detection reads from here instead of a getProductById round-trip per row.
  currentFields?: Map<string, ChildProductFields>
  // When present, a changed existing child's field write is pushed here instead
  // of awaited inline, so the caller can flush them all together (concurrently)
  // rather than paying one round-trip per changed row in sequence.
  pendingWrites?: Array<{ childId: string; update: Parameters<typeof updateProduct>[1] }>
}

export async function upsertVariantForCombination(
  parentId: string,
  optionValueIds: string[],
  valueLabels: string[],
  fields: { price?: number; sku?: string | null; barcode?: string | null; stockCount?: number | null; weight?: number | null },
  ctx?: VariantUpsertContext,
): Promise<{ variantId: string; childProductId: string; created: boolean; changed: boolean }> {
  const parent = ctx?.parent ?? await getProductById(parentId)
  if (!parent) throw new Error('Parent not found')

  const existing = ctx?.existing ?? await getVariants(parentId)
  const valueMap = ctx?.valueMap ?? await getVariantValueMap(parentId)
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
    // Keep a caller-supplied context current so a later row naming the same
    // combination matches this new variant instead of creating a duplicate.
    if (ctx) {
      ctx.existing.push({ id: cv.id, productId: parentId, childProductId: child.id, enabled: true, position: existing.length })
      ctx.valueMap[cv.id] = optionValueIds
    }
  }

  // A freshly created child always needs this write (creation only set price,
  // stock and trackInventory off the parent - sku/barcode/weight never land any
  // other way). An existing one is compared against its current row first: a
  // CSV re-import supplies every column on every row regardless of whether the
  // owner actually touched it, and writing that back unconditionally on a
  // catalogue with hundreds of variants was the other half (alongside the image
  // rewrite) of what pushed a Pull past the request budget.
  let changed = created
  if (!created) {
    // Prefer the pre-loaded field map; fall back to a direct read only when the
    // caller didn't supply one (single-row callers like the variant edit endpoint).
    const currentChild = ctx?.currentFields?.get(childId) ?? await getProductById(childId)
    changed = !currentChild
      || (fields.price !== undefined && Number(currentChild.price) !== fields.price)
      || (fields.sku !== undefined && (currentChild.sku ?? null) !== (fields.sku ?? null))
      || (fields.barcode !== undefined && (currentChild.barcode ?? null) !== (fields.barcode ?? null))
      || (fields.stockCount !== undefined && currentChild.stockCount !== fields.stockCount)
      || (fields.weight !== undefined && (currentChild.weight == null ? null : Number(currentChild.weight)) !== fields.weight)
  }

  if (changed) {
    const update = {
      ...(fields.price !== undefined ? { price: fields.price } : {}),
      ...(fields.sku !== undefined ? { sku: fields.sku } : {}),
      ...(fields.barcode !== undefined ? { barcode: fields.barcode } : {}),
      ...(fields.stockCount !== undefined ? { stockCount: fields.stockCount, trackInventory: fields.stockCount != null } : {}),
      ...(fields.weight !== undefined ? { weight: fields.weight } : {}),
    }
    // Batch caller: bank the write for a concurrent flush. Everyone else writes
    // inline, exactly as before. A freshly created child is never deferred - its
    // fields must land before any provider hook or image write touches the row.
    if (ctx?.pendingWrites && !created) ctx.pendingWrites.push({ childId, update })
    else await updateProduct(childId, update)
  }
  return { variantId, childProductId: childId, created, changed }
}
