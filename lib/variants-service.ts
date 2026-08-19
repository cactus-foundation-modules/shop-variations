// Orchestration that spans shop-variations' own tables and the shop module's
// product functions. Concrete variants are ordinary hidden shp_products rows;
// this layer creates/removes them through shop's createProduct/deleteProduct so
// inventory, checkout and refunds keep working with no shop changes.
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { createProduct, updateProduct, deleteProduct, getProductById, getProductBySlug, getProductMedia } from '@/modules/shop/lib/db/products'
import { slugify, ensureUniqueProductSlug } from '@/modules/shop/lib/slug'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { effectivePrice, isOnSale, isPriceTypeEnabled } from '@/modules/shop/lib/pricing'
import { makeDisplayAdjuster, resolveTaxDisplay } from '@/modules/shop/lib/tax-display'
import { canSeeStockLevels } from '@/modules/shop/lib/admin-stock'
import { canSeeProductCodes } from '@/modules/shop/lib/admin-codes'
import { minOrderQuantity, resolveMinOrderQuantity } from '@/modules/shop/lib/min-order'
import { getOptionsWithValues, getOptionsWithValuesForProducts } from '@/modules/shop-variations/lib/db/options'
import { getVariants, getVariantValueMap, getVariantAliasMap, getVariantByChildProductId, getVariantsForProducts, getVariantValueMapForProducts, createVariant, setVariantPositions, type ChildProductFields } from '@/modules/shop-variations/lib/db/variants'
import { getAddons, getAddonsForProducts } from '@/modules/shop-variations/lib/db/addons'
import { getBaseImagesLast } from '@/modules/shop-variations/lib/db/product-gallery'
import type { ShpProduct } from '@/modules/shop/lib/types'
import type { SvrAddon, SvrAddonConfig, SvrOptionWithValues, VariantSelectorPayload, VariantSelectorVariant } from '@/modules/shop-variations/lib/types'

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
  sale_price: unknown
  retail_price: unknown
  track_inventory: boolean
  stock_count: number | null
  out_of_stock_behaviour: string
  is_pre_order: boolean
  sku: string | null
  sale_sku: string | null
  supplier: string | null
  min_order_quantity: number | null
}

// Everything the storefront selector needs in one payload: option controls,
// each variant's child price/stock/image, and the personalisation add-ons.
export async function getVariantSelectorPayload(parentId: string): Promise<VariantSelectorPayload | null> {
  const parent = await getProductById(parentId)
  if (!parent) return null

  // Which optional price types the shop has switched on. The only one that can
  // move money is `sale`, and it moves it for a variant exactly as it does for
  // an ordinary product - so the figure below goes through shop's effectivePrice
  // rather than reading the child's `price` column raw, which is what used to
  // advertise the full price on a variant that was on offer.
  const config = await getShopConfigCached()
  const { enabledPriceTypes } = config
  // Whether this shop puts an RRP in front of shoppers at all - the same switch
  // shop's own price block reads through priceView, so a product with options
  // and one without can never disagree about whether there is an RRP to show.
  const showRetail = isPriceTypeEnabled(enabledPriceTypes, 'retail')
  // The child row is queried regardless (it's one extra column on a query that
  // already runs), but is only ever handed to a shopper when the shop has both
  // switched the field on for variations AND agreed to show it - otherwise a
  // supplier kept as a private buying reference would leak through this public
  // payload even with the storefront row switched off.
  const exposeSupplier = config.supplierFieldEnabled && config.supplierShowOnFrontend && config.supplierFieldScope === 'PRODUCTS_AND_VARIATIONS'
  // Same treatment for the stock figure, and for the same reason: a shopper is
  // told whether a combination is buyable (`inStock`, worked out here) and never
  // how many of it there are. Staff get the count, so the owner can read the
  // shelf off the product page itself - see shop's lib/admin-stock.ts. This
  // payload is built per request and never cached across viewers, so a shopper
  // cannot be served an admin's copy.
  const exposeStock = await canSeeStockLevels()
  // And the buying codes, on the same terms: the chosen combination's own SKU
  // and the supplier's clearance code are staff references, so they are withheld
  // from the payload itself rather than merely left unrendered - a shopper's
  // copy has nothing in it to read out of the network tab. See shop's
  // lib/admin-codes.ts.
  const exposeCodes = await canSeeProductCodes()

  // Whether the shop prints its prices net or gross is shop's own setting, and
  // it applies to a variation exactly as it does to an ordinary product - so
  // every figure below is converted here, on the way out, at the PARENT's tax
  // class. Doing it once on the payload rather than in the picker keeps the tax
  // arithmetic off the client entirely and means a surcharge can never end up
  // on the other side of tax from the price it is added to. Nothing here is
  // authoritative: the cart re-resolves each line from the products, so what a
  // shopper is charged is unaffected by what this payload says.
  const taxDisplay = await resolveTaxDisplay()
  const adjust = makeDisplayAdjuster(taxDisplay, parent.taxClassId)
  const shown = (amount: number) => (adjust ? adjust(amount) : amount)

  const [options, variants, valueMap, aliasMap, addons, baseMedia, baseImagesLast] = await Promise.all([
    getOptionsWithValues(parentId),
    getVariants(parentId),
    getVariantValueMap(parentId),
    getVariantAliasMap(parentId),
    getAddons(parentId),
    getProductMedia(parentId),
    getBaseImagesLast(parentId),
  ])

  const childIds = variants.map((v) => v.childProductId)
  const childById = new Map<string, ChildRow>()
  const imagesByChild = new Map<string, string[]>()
  if (childIds.length > 0) {
    const childRows = await prisma.$queryRaw<ChildRow[]>`
      SELECT "id", "price", "sale_price", "retail_price", "track_inventory", "stock_count", "out_of_stock_behaviour", "is_pre_order", "sku", "sale_sku", "supplier", "min_order_quantity"
      FROM "shp_products" WHERE "id" IN (${Prisma.join(childIds)})
    `
    for (const r of childRows) childById.set(r.id, r)
    const mediaRows = await prisma.$queryRaw<{ product_id: string; url: string }[]>`
      SELECT "product_id", "url"
      FROM "shp_product_media"
      WHERE "product_id" IN (${Prisma.join(childIds)}) AND "type" = 'IMAGE'
      ORDER BY "product_id", "is_primary" DESC, "position" ASC
    `
    for (const r of mediaRows) {
      const list = imagesByChild.get(r.product_id)
      if (list) list.push(r.url)
      else imagesByChild.set(r.product_id, [r.url])
    }
  }

  const selectorVariants: VariantSelectorVariant[] = variants.map((v) => {
    const child = childById.get(v.childProductId)
    const stockCount = child?.stock_count ?? null
    const tracks = child?.track_inventory ?? false
    const inStock = !tracks || (stockCount ?? 0) > 0 || child?.out_of_stock_behaviour === 'BACKORDER' || child?.is_pre_order === true
    // A variant with no child row of its own falls back to the parent, prices
    // and all, so an incomplete matrix shows the product's own figure rather
    // than nothing.
    const priced = child
      ? { price: Number(child.price), salePrice: child.sale_price != null ? Number(child.sale_price) : null }
      : { price: Number(parent.price), salePrice: parent.salePrice }
    // The combination's own RRP, on the same terms shop gives an ordinary
    // product's: withheld outright when the shop has the retail price type
    // switched off, and converted to the side of tax the rest of the payload
    // sits on. Whether it is worth PRINTING (it only is while it sits above what
    // is being charged) is decided where it is rendered, because a
    // personalisation surcharge can move the charged figure after this.
    const retailStored = child ? child.retail_price : parent.retailPrice
    const retail = showRetail && retailStored != null ? Number(retailStored) : null
    return {
      id: v.id,
      childProductId: v.childProductId,
      optionValueIds: valueMap[v.id] ?? [],
      aliasValueIds: aliasMap[v.id] ?? [],
      enabled: v.enabled,
      price: shown(effectivePrice(priced, enabledPriceTypes)),
      compareAtPrice: isOnSale(priced, enabledPriceTypes) ? shown(Number(priced.price)) : null,
      retailPrice: retail != null && Number.isFinite(retail) ? shown(retail) : null,
      inStock,
      stockCount: exposeStock && tracks ? stockCount : null,
      tracksStock: tracks,
      imageUrls: imagesByChild.get(v.childProductId) ?? [],
      showImageInGallery: v.showImageInGallery,
      showModelInGallery: v.showModelInGallery,
      sku: exposeCodes ? child?.sku ?? null : null,
      saleSku: exposeCodes ? child?.sale_sku ?? null : null,
      supplier: exposeSupplier ? child?.supplier ?? null : null,
      // The fewest of THIS combination the shop sells in one go, falling back to
      // the parent's figure where the child carries none - so an owner sets one
      // minimum on the product rather than across three hundred rows, and still
      // gets to say "this one size only goes out in pairs". Not gated on any
      // setting: a shopper has to be told before they press the button.
      minOrderQuantity: resolveMinOrderQuantity(child?.min_order_quantity, parent.minOrderQuantity),
    }
  })

  return {
    productId: parentId,
    productName: parent.name,
    // The parent's own money, through shop's effectivePrice exactly as each
    // variant's is - so a product bought at its own price (nothing to choose, or
    // add-ons alone) quotes its sale price rather than the full one it is not
    // being charged. Reading `price` raw here is what left a reduced product
    // showing the dearer figure below its own sale price.
    basePrice: shown(effectivePrice(parent, enabledPriceTypes)),
    baseCompareAtPrice: isOnSale(parent, enabledPriceTypes) ? shown(Number(parent.price)) : null,
    // The parent's own RRP, for the stretch before a combination resolves (and
    // for a product we claimed for its add-ons alone, where the parent IS the
    // thing being bought). Null on the great majority: a product whose money
    // lives on its variations keeps no retail price of its own.
    baseRetailPrice: showRetail && parent.retailPrice != null ? shown(Number(parent.retailPrice)) : null,
    baseImages: baseMedia.filter((m) => m.type === 'IMAGE').map((m) => ({ url: m.url, alt: m.altText ?? parent.name })),
    baseImagesLast,
    options,
    variants: selectorVariants,
    addons: adjust ? addons.map((a) => ({ ...a, config: adjustAddonPrices(a.config, shown) })) : addons,
    priceSuffix: taxDisplay.display.suffix,
    showStockCounts: exposeStock,
    showCodes: exposeCodes,
    baseStock: exposeStock ? { tracked: parent.trackInventory, count: parent.stockCount } : null,
    // The parent's own smallest order: what stands before a combination has
    // resolved, and what IS the minimum on a product claimed for its add-ons
    // alone, where the parent is the thing being bought.
    baseMinOrderQuantity: minOrderQuantity(parent.minOrderQuantity),
  }
}

// An add-on's surcharges, converted alongside the prices they are added to. Only
// the money keys are touched; everything else (limits, help text, choice labels)
// is passed through as it stands.
function adjustAddonPrices(config: SvrAddonConfig, shown: (amount: number) => number): SvrAddonConfig {
  return {
    ...config,
    flatPrice: config.flatPrice != null ? shown(config.flatPrice) : config.flatPrice,
    pricePerChar: config.pricePerChar != null ? shown(config.pricePerChar) : config.pricePerChar,
    choices: config.choices?.map((c) => (c.price != null ? { ...c, price: shown(c.price) } : c)),
  }
}

// Slug-based storefront lookup: the product page knows the slug (from its URL),
// not the id, and variations keeps zero product-context injection in shop.
export async function getVariantSelectorPayloadBySlug(slug: string): Promise<VariantSelectorPayload | null> {
  const product = await getProductBySlug(slug)
  if (!product || product.catalogueHidden) return null
  return getVariantSelectorPayload(product.id)
}

export type VariantDeepLink = {
  // The parent product whose page should render under the variant's own URL.
  parent: ShpProduct
  // The option-value ids that pick this exact variant, handed to the selector so
  // it opens on that combination.
  optionValueIds: string[]
}

// Resolve a variant child product - the catalogue-hidden row a shopper buys
// through its parent's page - to the parent whose page should render under the
// child's own URL, plus the picks that select it. That URL is the link the cart
// already builds (and anyone can share); shop 404s the hidden child on its own
// account, so this is what lets the link instead open the parent already
// configured to the variant. Null for anything that is not a live variant child
// of a visible, active parent: a normal product, an unknown slug, or a child
// whose variant row or parent has since gone.
export async function resolveVariantDeepLink(child: ShpProduct): Promise<VariantDeepLink | null> {
  if (!child.catalogueHidden) return null
  const variant = await getVariantByChildProductId(child.id)
  if (!variant) return null
  const parent = await getProductById(variant.productId)
  if (!parent || parent.catalogueHidden || parent.status !== 'ACTIVE') return null
  const valueMap = await getVariantValueMap(parent.id)
  const optionValueIds = valueMap[variant.id] ?? []
  if (optionValueIds.length === 0) return null
  return { parent, optionValueIds }
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
  // Whether this variation's photo, and separately its 3D model, are promoted
  // onto the parent's gallery before the shopper has chosen anything - the
  // grid's two "Show up front" tick boxes.
  showImageInGallery: boolean
  showModelInGallery: boolean
  price: number
  // The optional price types, exactly as the product editor's Pricing tab holds
  // them. Null means "not set on this variant", which is a different thing from
  // zero and must stay tellable apart from it all the way to the input box.
  salePrice: number | null
  retailPrice: number | null
  tradePrice: number | null
  costPrice: number | null
  sku: string | null
  // The code this variation is ordered under while it is on offer, where the
  // supplier issues a separate one. Offered in the grid only where the shop has
  // the sale price type switched on, since that is when it applies.
  saleSku: string | null
  barcode: string | null
  // Who supplied this particular variation. Offered in the grid only when the
  // shop has switched the supplier field on for variations as well as products.
  supplier: string | null
  trackInventory: boolean
  stockCount: number | null
  // The fewest of this combination the shop sells in one go. Null means "as the
  // product says" rather than "one" - the grid shows the parent's figure as the
  // placeholder so a blank cell is not mistaken for no minimum.
  minOrderQuantity: number | null
  weight: number | null
  // Every image on this variant's hidden child product, primary first.
  imageUrls: string[]
}

export type EditorPayload = {
  // `minOrderQuantity` is the PARENT's own, already normalised - the grid shows
  // it as the placeholder in each row's Min qty box, so a blank cell reads as
  // "as the product says" rather than as "no minimum".
  product: { id: string; name: string; slug: string; price: number; minOrderQuantity: number }
  options: SvrOptionWithValues[]
  variants: VariantEditorRow[]
  addons: SvrAddon[]
}

// An optional price column as the editor wants it: a number, or null for "left
// blank". Prisma hands these back as Decimal, and Number(null) is 0 - which
// would quietly turn every unset retail price into a free item on screen.
function optionalPrice(value: unknown): number | null {
  return value == null ? null : Number(value)
}

type ChildEditRow = ChildRow & {
  sale_sku: string | null
  barcode: string | null
  min_order_quantity: number | null
  supplier: string | null
  weight: unknown
  retail_price: unknown
  trade_price: unknown
  cost_price: unknown
}

type EditorPayloadParent = { id: string; name: string; slug: string; price: number | string; minOrderQuantity?: number | null }

// Shared by getEditorPayload and getEditorPayloadsBatch: turns one parent's
// already-fetched options/variants/value-map/addons plus the shared child-row
// and child-image lookups into its EditorPayload.
function buildEditorPayload(
  parent: EditorPayloadParent,
  options: SvrOptionWithValues[],
  variants: Awaited<ReturnType<typeof getVariants>>,
  valueMap: Record<string, string[]>,
  addons: SvrAddon[],
  childById: Map<string, ChildEditRow>,
  imagesByChild: Map<string, string[]>,
): EditorPayload {
  const labelByValueId = new Map<string, string>()
  const valueOptionOrder = new Map<string, number>()
  options.forEach((o, oi) => o.values.forEach((v) => { labelByValueId.set(v.id, v.label); valueOptionOrder.set(v.id, oi) }))

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
      showImageInGallery: v.showImageInGallery,
      showModelInGallery: v.showModelInGallery,
      price: child ? Number(child.price) : Number(parent.price),
      salePrice: optionalPrice(child?.sale_price),
      retailPrice: optionalPrice(child?.retail_price),
      tradePrice: optionalPrice(child?.trade_price),
      costPrice: optionalPrice(child?.cost_price),
      sku: child?.sku ?? null,
      saleSku: child?.sale_sku ?? null,
      barcode: child?.barcode ?? null,
      supplier: child?.supplier ?? null,
      trackInventory: child?.track_inventory ?? false,
      stockCount: child?.stock_count ?? null,
      minOrderQuantity: child?.min_order_quantity ?? null,
      weight: child?.weight != null ? Number(child.weight) : null,
      imageUrls: imagesByChild.get(v.childProductId) ?? [],
    }
  })

  return {
    product: {
      id: parent.id, name: parent.name, slug: parent.slug, price: Number(parent.price),
      // What a blank cell in the grid's Min qty column actually means for this
      // product, so the placeholder can say it rather than showing an empty box.
      minOrderQuantity: minOrderQuantity(parent.minOrderQuantity),
    },
    options,
    variants: rows,
    addons,
  }
}

// One parent's child rows + child images, keyed for buildEditorPayload.
async function loadChildRowsAndImages(childIds: string[]): Promise<{ childById: Map<string, ChildEditRow>; imagesByChild: Map<string, string[]> }> {
  const childById = new Map<string, ChildEditRow>()
  const imagesByChild = new Map<string, string[]>()
  if (childIds.length === 0) return { childById, imagesByChild }
  const childRows = await prisma.$queryRaw<ChildEditRow[]>`
    SELECT "id", "price", "sale_price", "retail_price", "trade_price", "cost_price",
           "sku", "sale_sku", "barcode", "supplier", "track_inventory", "stock_count", "out_of_stock_behaviour", "is_pre_order", "weight", "min_order_quantity"
    FROM "shp_products" WHERE "id" IN (${Prisma.join(childIds)})
  `
  for (const r of childRows) childById.set(r.id, r)
  const mediaRows = await prisma.$queryRaw<{ product_id: string; url: string }[]>`
    SELECT "product_id", "url"
    FROM "shp_product_media"
    WHERE "product_id" IN (${Prisma.join(childIds)}) AND "type" = 'IMAGE'
    ORDER BY "product_id", "is_primary" DESC, "position" ASC
  `
  for (const r of mediaRows) {
    const list = imagesByChild.get(r.product_id)
    if (list) list.push(r.url)
    else imagesByChild.set(r.product_id, [r.url])
  }
  return { childById, imagesByChild }
}

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

  const { childById, imagesByChild } = await loadChildRowsAndImages(variants.map((v) => v.childProductId))
  return buildEditorPayload(parent, options, variants, valueMap, addons, childById, imagesByChild)
}

// Batched EditorPayload for many parents at once - the options/variants/value-map/
// addons queries and the child-row/child-image queries each run once for the
// whole set, in place of calling getEditorPayload per parent. A Google-Sheet Pull
// preview or deletion plan touches every parent product named in the sheet, so
// the per-parent version turned a Pull over hundreds of products into hundreds of
// round trips; this is the same data, fetched with `product_id IN (...)`/
// `child_id IN (...)` instead of once per id.
export async function getEditorPayloadsBatch(parents: EditorPayloadParent[]): Promise<Map<string, EditorPayload>> {
  const map = new Map<string, EditorPayload>()
  if (parents.length === 0) return map
  const parentIds = parents.map((p) => p.id)

  const [optionsByProduct, variantsByProduct, valueMapByProduct, addonsByProduct] = await Promise.all([
    getOptionsWithValuesForProducts(parentIds),
    getVariantsForProducts(parentIds),
    getVariantValueMapForProducts(parentIds),
    getAddonsForProducts(parentIds),
  ])

  const allChildIds = [...variantsByProduct.values()].flat().map((v) => v.childProductId)
  const { childById, imagesByChild } = await loadChildRowsAndImages(allChildIds)

  for (const parent of parents) {
    map.set(parent.id, buildEditorPayload(
      parent,
      optionsByProduct.get(parent.id) ?? [],
      variantsByProduct.get(parent.id) ?? [],
      valueMapByProduct.get(parent.id) ?? {},
      addonsByProduct.get(parent.id) ?? [],
      childById,
      imagesByChild,
    ))
  }

  return map
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
  fields: {
    price?: number
    // The optional price types, threaded through so a variant can carry its RRP,
    // trade and cost the same way a top-level product does. null clears the
    // figure, undefined leaves it alone (an absent column), a number sets it.
    salePrice?: number | null
    retailPrice?: number | null
    tradePrice?: number | null
    costPrice?: number | null
    sku?: string | null
    saleSku?: string | null
    barcode?: string | null
    supplier?: string | null
    stockCount?: number | null
    // The fewest of this combination sold in one go. null clears it, which means
    // "as the product says" rather than "one".
    minOrderQuantity?: number | null
    weight?: number | null
  },
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
      // Matches what createVariant just wrote: a new variation is never
      // promoted onto the parent's gallery until someone ticks one of the boxes.
      ctx.existing.push({ id: cv.id, productId: parentId, childProductId: child.id, enabled: true, showImageInGallery: false, showModelInGallery: false, position: existing.length })
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
    // Both sources present the optional prices differently (the pre-loaded map as
    // number|null, getProductById as string|null), so coerce before comparing.
    const curPrice = (v: unknown): number | null => (v == null ? null : Number(v))
    changed = !currentChild
      || (fields.price !== undefined && Number(currentChild.price) !== fields.price)
      || (fields.salePrice !== undefined && curPrice(currentChild.salePrice) !== fields.salePrice)
      || (fields.retailPrice !== undefined && curPrice(currentChild.retailPrice) !== fields.retailPrice)
      || (fields.tradePrice !== undefined && curPrice(currentChild.tradePrice) !== fields.tradePrice)
      || (fields.costPrice !== undefined && curPrice(currentChild.costPrice) !== fields.costPrice)
      || (fields.sku !== undefined && (currentChild.sku ?? null) !== (fields.sku ?? null))
      || (fields.saleSku !== undefined && (currentChild.saleSku ?? null) !== (fields.saleSku ?? null))
      || (fields.barcode !== undefined && (currentChild.barcode ?? null) !== (fields.barcode ?? null))
      || (fields.supplier !== undefined && (currentChild.supplier ?? null) !== (fields.supplier ?? null))
      || (fields.stockCount !== undefined && currentChild.stockCount !== fields.stockCount)
      || (fields.minOrderQuantity !== undefined && (currentChild.minOrderQuantity ?? null) !== (fields.minOrderQuantity ?? null))
      || (fields.weight !== undefined && (currentChild.weight == null ? null : Number(currentChild.weight)) !== fields.weight)
  }

  if (changed) {
    const update = {
      ...(fields.price !== undefined ? { price: fields.price } : {}),
      ...(fields.salePrice !== undefined ? { salePrice: fields.salePrice } : {}),
      ...(fields.retailPrice !== undefined ? { retailPrice: fields.retailPrice } : {}),
      ...(fields.tradePrice !== undefined ? { tradePrice: fields.tradePrice } : {}),
      ...(fields.costPrice !== undefined ? { costPrice: fields.costPrice } : {}),
      ...(fields.sku !== undefined ? { sku: fields.sku } : {}),
      ...(fields.saleSku !== undefined ? { saleSku: fields.saleSku } : {}),
      ...(fields.barcode !== undefined ? { barcode: fields.barcode } : {}),
      ...(fields.supplier !== undefined ? { supplier: fields.supplier } : {}),
      ...(fields.stockCount !== undefined ? { stockCount: fields.stockCount, trackInventory: fields.stockCount != null } : {}),
      ...(fields.minOrderQuantity !== undefined ? { minOrderQuantity: fields.minOrderQuantity } : {}),
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
