import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { getSessionFromCookie } from '@/lib/auth/session'
import { resolveVariantFieldProviders } from '@/modules/shop-variations/lib/variant-field-providers'
import { fileUrlsFromValue, findMissingUrls } from '@/modules/shop-variations/lib/lost-files'
import {
  memberColumnId,
  mergeContributedColumns,
  mergeValues,
  type ColumnContribution,
  type MergedVariationColumn,
} from '@/modules/shop-variations/lib/variation-columns'

// The data layer behind the cross-product Variations browser (the Variations tab
// on Shop > Products). It lists every variant across every product, joins each to
// its hidden child product for price/SKU/stock/image, and folds in the columns
// other modules contribute through the `variant-field-provider` point - which is
// how the 3D file and attribute values reach the grid without this module knowing
// what either is. All the browser's filters (a specific product, missing image,
// missing any contributed column, and the "lost" pair - an image or file column
// whose url no longer resolves) resolve here.
//
// Contributed columns are merged by heading before they leave: a provider keys
// its columns per product, so one attribute used across fifty products arrives as
// fifty keys under one heading, and the browser wants one column and one filter
// entry for it. See collectColumns.

export type VariationListColumn = {
  id: string
  label: string
  /** 'file' when the column's value holds file urls, so a "lost" filter applies. */
  kind?: 'text' | 'file'
}

export type VariationListRow = {
  variantId: string
  productId: string
  productName: string
  productSlug: string
  childProductId: string
  label: string
  enabled: boolean
  sku: string | null
  price: number
  salePrice: number | null
  trackInventory: boolean
  stockCount: number | null
  imageUrl: string | null
  /** Contributed-column values for this variant, keyed by column id. */
  fields: Record<string, string>
}

export type VariationListResult = {
  rows: VariationListRow[]
  total: number
  page: number
  perPage: number
  /** Contributed columns (3D files, attributes) present across the filtered set. */
  columns: VariationListColumn[]
  /** Every product with at least one variation, for the filter dropdown. */
  products: Array<{ id: string; name: string }>
}

export type VariationListParams = {
  productId?: string
  search?: string
  /**
   * '' = no filter. 'image' = no image at all; a bare contributed column id = that
   * column is empty. Prefix either with `lost:` ('lost:image', 'lost:<column id>')
   * to instead find the ones that DO have a file recorded whose url no longer
   * resolves - a reference left behind by a rename or a deletion.
   */
  missing?: string
  page?: number
  perPage?: number
}

/** The `lost:` prefix on the `missing` param, split off from the target. */
export const LOST_PREFIX = 'lost:'

const DEFAULT_PER_PAGE = 50
const MAX_PER_PAGE = 200

type BaseRow = {
  variant_id: string
  product_id: string
  product_name: string
  product_slug: string
  child_product_id: string
  enabled: boolean
  price: unknown
  sale_price: unknown
  sku: string | null
  track_inventory: boolean
  stock_count: number | null
  image_url: string | null
}

type Providers = Awaited<ReturnType<typeof resolveVariantFieldProviders>>

// Group each product's child (variant) product ids together, so a per-product
// field provider can be asked once per product rather than once per variant.
function groupChildIdsByProduct(rows: Array<{ product_id: string; child_product_id: string }>): Map<string, string[]> {
  const byProduct = new Map<string, string[]>()
  for (const r of rows) {
    const list = byProduct.get(r.product_id)
    if (list) list.push(r.child_product_id)
    else byProduct.set(r.product_id, [r.child_product_id])
  }
  return byProduct
}

// Every contributed column across the products in view, merged by heading so one
// attribute used across the catalogue is one column and one filter entry rather
// than one per product. The merge itself lives in variation-columns.ts; this only
// gathers the contributions to feed it.
async function collectColumns(providers: Providers, childIdsByProduct: Map<string, string[]>): Promise<MergedVariationColumn[]> {
  const contributions: ColumnContribution[] = []
  for (const { id: providerId, provider } of providers) {
    for (const productId of childIdsByProduct.keys()) {
      contributions.push({ providerId, columns: await provider.listColumns(productId) })
    }
  }
  return mergeContributedColumns(contributions)
}

// Every contributed cell value for the given variants, keyed child id -> column id
// -> value. Providers answer per product, so ids are grouped first.
async function collectValues(providers: Providers, childIdsByProduct: Map<string, string[]>): Promise<Map<string, Record<string, string>>> {
  const byChild = new Map<string, Record<string, string>>()
  for (const { id: provId, provider } of providers) {
    for (const [productId, childIds] of childIdsByProduct) {
      const values = await provider.getValues(productId, childIds)
      for (const [childId, byKey] of Object.entries(values)) {
        const rec = byChild.get(childId) ?? {}
        for (const [key, val] of Object.entries(byKey)) rec[memberColumnId(provId, key)] = val
        byChild.set(childId, rec)
      }
    }
  }
  return byChild
}

export async function getVariationsList(
  params: VariationListParams,
  user: Awaited<ReturnType<typeof getSessionFromCookie>>,
): Promise<VariationListResult> {
  const page = Math.max(1, params.page ?? 1)
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, params.perPage ?? DEFAULT_PER_PAGE))
  const filter = params.missing?.trim() || ''
  // A `lost:` filter looks at the ones that DO have a file recorded and asks
  // whether its url still resolves, so it is the exact opposite selection to the
  // plain "missing" filter of the same target - never a variation of it.
  const lost = filter.startsWith(LOST_PREFIX) ? filter.slice(LOST_PREFIX.length) : ''
  const missing = lost ? '' : filter
  const search = params.search?.trim() || ''

  // Base filters that SQL can answer: a specific product, a name/SKU search, and
  // "missing image". "Missing <contributed column>" cannot - the value lives in
  // another module - so it is applied in JS below, against the fetched set.
  const where: Prisma.Sql[] = [Prisma.sql`p."catalogue_hidden" = false`]
  if (params.productId) where.push(Prisma.sql`v."product_id" = ${params.productId}`)
  if (search) {
    const like = `%${search}%`
    where.push(Prisma.sql`(p."name" ILIKE ${like} OR c."sku" ILIKE ${like})`)
  }
  if (missing === 'image') {
    where.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "shp_product_media" m WHERE m."product_id" = v."child_product_id" AND m."type" = 'IMAGE')`)
  }

  const baseRows = await prisma.$queryRaw<BaseRow[]>`
    SELECT
      v."id" AS variant_id, v."product_id", v."child_product_id", v."enabled",
      p."name" AS product_name, p."slug" AS product_slug,
      c."price", c."sale_price", c."sku", c."track_inventory", c."stock_count",
      (SELECT m."url" FROM "shp_product_media" m
        WHERE m."product_id" = v."child_product_id" AND m."type" = 'IMAGE'
        ORDER BY m."is_primary" DESC, m."position" ASC LIMIT 1) AS image_url
    FROM "svr_variants" v
    JOIN "shp_products" p ON p."id" = v."product_id"
    LEFT JOIN "shp_products" c ON c."id" = v."child_product_id"
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY p."name" ASC, v."position" ASC, v."created_at" ASC
  `

  // Human label for each variant: its option values in option order ("L / Red").
  const variantIds = baseRows.map((r) => r.variant_id)
  const labelByVariant = new Map<string, string>()
  if (variantIds.length > 0) {
    const labelRows = await prisma.$queryRaw<{ variant_id: string; label: string; opt_pos: number; val_pos: number }[]>`
      SELECT vv."variant_id", ov."label", o."position" AS opt_pos, ov."position" AS val_pos
      FROM "svr_variant_values" vv
      JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
      JOIN "svr_options" o ON o."id" = ov."option_id"
      WHERE vv."variant_id" IN (${Prisma.join(variantIds)})
    `
    const grouped = new Map<string, { label: string; opt_pos: number; val_pos: number }[]>()
    for (const r of labelRows) {
      const list = grouped.get(r.variant_id)
      if (list) list.push(r)
      else grouped.set(r.variant_id, [r])
    }
    for (const [vid, list] of grouped) {
      list.sort((a, b) => a.opt_pos - b.opt_pos || a.val_pos - b.val_pos)
      labelByVariant.set(vid, list.map((x) => x.label).join(' / '))
    }
  }

  const providers = user ? await resolveVariantFieldProviders(user) : []

  // Columns are computed across the whole filtered set so the headers stay stable
  // as the user pages through. Values are only needed in bulk when a "missing
  // <column>" filter is active (it filters on them); otherwise fetching them for
  // the current page alone is enough and far cheaper on a big catalogue.
  const columns = providers.length > 0 ? await collectColumns(providers, groupChildIdsByProduct(baseRows)) : []
  const lostOnField = lost !== '' && lost !== 'image'
  const filteringOnField = (missing !== '' && missing !== 'image') || lostOnField

  let fieldByChild = new Map<string, Record<string, string>>()
  let filtered = baseRows
  if (providers.length > 0 && filteringOnField) {
    fieldByChild = await collectValues(providers, groupChildIdsByProduct(baseRows))
  }
  if (missing !== '' && missing !== 'image') {
    filtered = baseRows.filter((r) => {
      const v = mergeValues(fieldByChild.get(r.child_product_id), columns)[missing]
      return !v || v.trim() === ''
    })
  }

  // "Lost <thing>": the file is still recorded but its url no longer resolves.
  // Every candidate url in the set is checked at once (deduplicated and cached
  // inside findMissingUrls), then the rows are narrowed to the ones holding a
  // dead url. A url that cannot be checked is not dead, so this under-reports
  // rather than pointing the owner at working photography.
  if (lost === 'image') {
    const dead = await findMissingUrls(baseRows.map((r) => r.image_url).filter((u): u is string => !!u))
    filtered = dead.size === 0 ? [] : baseRows.filter((r) => !!r.image_url && dead.has(r.image_url))
  } else if (lostOnField) {
    const urlsByChild = new Map<string, string[]>()
    for (const r of baseRows) {
      if (urlsByChild.has(r.child_product_id)) continue
      urlsByChild.set(r.child_product_id, fileUrlsFromValue(mergeValues(fieldByChild.get(r.child_product_id), columns)[lost]))
    }
    const dead = await findMissingUrls([...urlsByChild.values()].flat())
    filtered = dead.size === 0
      ? []
      : baseRows.filter((r) => (urlsByChild.get(r.child_product_id) ?? []).some((u) => dead.has(u)))
  }

  const total = filtered.length
  const pageRows = filtered.slice((page - 1) * perPage, page * perPage)

  if (providers.length > 0 && !filteringOnField) {
    fieldByChild = await collectValues(providers, groupChildIdsByProduct(pageRows))
  }

  const products = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT DISTINCT p."id", p."name"
    FROM "svr_variants" v
    JOIN "shp_products" p ON p."id" = v."product_id"
    WHERE p."catalogue_hidden" = false
    ORDER BY p."name" ASC
  `

  return {
    rows: pageRows.map((r) => ({
      variantId: r.variant_id,
      productId: r.product_id,
      productName: r.product_name,
      productSlug: r.product_slug,
      childProductId: r.child_product_id,
      label: labelByVariant.get(r.variant_id) ?? '',
      enabled: r.enabled,
      sku: r.sku ?? null,
      price: r.price == null ? 0 : Number(r.price),
      salePrice: r.sale_price == null ? null : Number(r.sale_price),
      trackInventory: r.track_inventory,
      stockCount: r.stock_count == null ? null : Number(r.stock_count),
      imageUrl: r.image_url ?? null,
      fields: mergeValues(fieldByChild.get(r.child_product_id), columns),
    })),
    total,
    page,
    perPage,
    // `members` is internal bookkeeping (a product's assignment ids); the browser
    // only ever deals in the merged id.
    columns: columns.map(({ id, label, kind }) => ({ id, label, kind })),
    products,
  }
}
