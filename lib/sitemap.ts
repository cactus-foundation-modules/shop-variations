import type { MetadataRoute } from 'next'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { hidesOutOfStockFromShoppers, outOfStockSql } from '@/modules/shop/lib/stock-visibility'
import { productUrl, type ProductUrlStyle } from '@/modules/shop/lib/product-url'
import { buildVariationQuery, optionParamKey } from '@/modules/shop-variations/lib/url-selection'

// Every buyable combination of a product's options, as its own URL, merged into
// the site's /sitemap.xml by scripts/generate-module-router.mjs (which scans for
// this export by name, the same way it finds shop's).
//
// Why: a listing with options is not one page as far as a shopper is concerned.
// "Prism chair, with headrest, in Rivet Forge" is a different picture, a
// different price and a different thing to search for than the bare listing, and
// the storefront already serves it at its own address - the option parameters a
// shopper writes into the URL as they choose (lib/url-selection.ts). Nothing was
// ever telling a search engine those addresses existed.
//
// Two rules keep this honest rather than merely large:
//
//  1. Only COMPLETE combinations that resolve to a real, enabled variation are
//     listed. A half-described one (no value for one of the product's options)
//     never resolves on the page, so publishing its URL would advertise an
//     address that quietly renders the bare listing.
//  2. What is published must be exactly what the page then declares canonical -
//     see lib/canonical-query-provider.ts. Both spell the address with
//     buildVariationQuery, in display order, from the variation's OWN values
//     (never an alias), so the two cannot drift apart.

// Sitemaps are capped at 50,000 URLs by the protocol - go over and the file is
// rejected whole, taking the ordinary product pages down with it. This leaves
// room underneath for a large catalogue's own pages. Truncation is logged rather
// than silent: a shop that hits it needs to know its sitemap is partial.
const MAX_VARIATION_URLS = 45_000

// The whole set is three queries over the entire variation matrix, and a crawler
// asks for the sitemap several times in a row. Short in-process memo so a burst
// costs one build rather than one per request. Nothing here is per-visitor - the
// stock rule taken is deliberately the shopper's, never the staff exemption - so
// there is no one to leak between.
const MEMO_TTL_MS = 5 * 60 * 1000
let memo: { key: string; at: number; entries: MetadataRoute.Sitemap } | null = null

export type VariantRow = {
  parent_id: string
  parent_slug: string
  parent_updated_at: Date
  value_ids: string[]
}

export type OptionRow = { product_id: string; option_id: string; option_name: string }
export type ValueRow = { option_id: string; value_id: string; value_slug: string }

export async function getPublicSitemapEntries(siteUrl: string): Promise<MetadataRoute.Sitemap> {
  const shopConfig = await getShopConfigCached()
  if (shopConfig.shopStatus === 'CLOSED') return []

  const memoKey = `${siteUrl}|${shopConfig.productUrlStyle}|${shopConfig.outOfStockVisibility}`
  if (memo && memo.key === memoKey && Date.now() - memo.at < MEMO_TTL_MS) return memo.entries

  // Same reasoning as shop's own sitemap: one file served to the whole world, so
  // it takes the shopper's answer on sold-out stock and never the staff
  // exemption. `p` here is the CHILD row - the thing that carries a variation's
  // stock - which is the alias every availability predicate is written against.
  const inStockOnly = hidesOutOfStockFromShoppers(shopConfig)
    ? Prisma.sql`AND NOT ${await outOfStockSql()}`
    : Prisma.empty

  const [variants, options, values] = await Promise.all([
    prisma.$queryRaw<VariantRow[]>`
      SELECT parent."id"         AS parent_id,
             parent."slug"       AS parent_slug,
             parent."updated_at" AS parent_updated_at,
             array_agg(svv."option_value_id") AS value_ids
      FROM "svr_variants" sv
      JOIN "shp_products" parent ON parent."id" = sv."product_id"
      JOIN "shp_products" p ON p."id" = sv."child_product_id"
      JOIN "svr_variant_values" svv ON svv."variant_id" = sv."id"
      WHERE sv."enabled" = true
        AND parent."status" = 'ACTIVE'
        AND parent."catalogue_hidden" = false
        ${inStockOnly}
      GROUP BY sv."id", sv."position", parent."id", parent."slug", parent."updated_at"
      ORDER BY parent."slug" ASC, sv."position" ASC
    `,
    // Ordered exactly as getOptionsWithValues orders them, because that order is
    // what the storefront's payload carries and therefore what decides which
    // option claims a parameter name when two would slugify alike. Read on its
    // own rather than joined to the values, so an option with no values at all
    // still counts towards "every option answered" and its product drops out
    // instead of publishing a combination the page cannot resolve.
    prisma.$queryRaw<OptionRow[]>`
      SELECT "product_id", "id" AS option_id, "name" AS option_name
      FROM "svr_options" ORDER BY "position" ASC, "created_at" ASC
    `,
    prisma.$queryRaw<ValueRow[]>`
      SELECT "option_id", "id" AS value_id, "slug" AS value_slug FROM "svr_option_values"
    `,
  ])

  const entries = buildVariationEntries(siteUrl, shopConfig.productUrlStyle, variants, options, values)
  memo = { key: memoKey, at: Date.now(), entries }
  return entries
}

/** The pure half, so the URL spelling is testable without a database. */
export function buildVariationEntries(
  siteUrl: string,
  urlStyle: ProductUrlStyle,
  variants: VariantRow[],
  options: OptionRow[],
  values: ValueRow[],
): MetadataRoute.Sitemap {
  // Per product: its options in display order, each with the parameter name it
  // claims. First claim wins, mirroring optionsByParamKey in url-selection.ts.
  // A product where a later option is left without a name of its own is dropped
  // whole below - two of its combinations would otherwise share one address, and
  // guessing which one a URL meant is exactly what the reader refuses to do.
  const optionsByProduct = new Map<string, Array<{ optionId: string; paramKey: string }>>()
  const ambiguousProducts = new Set<string>()
  for (const row of options) {
    let list = optionsByProduct.get(row.product_id)
    if (!list) { list = []; optionsByProduct.set(row.product_id, list) }
    const paramKey = optionParamKey(row.option_name)
    if (!paramKey || list.some((o) => o.paramKey === paramKey)) {
      ambiguousProducts.add(row.product_id)
      continue
    }
    list.push({ optionId: row.option_id, paramKey })
  }

  const valueIndex = new Map<string, { optionId: string; slug: string }>()
  for (const row of values) valueIndex.set(row.value_id, { optionId: row.option_id, slug: row.value_slug })

  const seen = new Set<string>()
  const entries: MetadataRoute.Sitemap = []
  let truncated = 0
  let unresolvable = 0

  for (const variant of variants) {
    if (ambiguousProducts.has(variant.parent_id)) { unresolvable++; continue }
    const productOptions = optionsByProduct.get(variant.parent_id)
    if (!productOptions || productOptions.length === 0) continue

    // One value per option, every option answered.
    const slugByOption = new Map<string, string>()
    let usable = true
    for (const valueId of variant.value_ids) {
      const value = valueIndex.get(valueId)
      if (!value || slugByOption.has(value.optionId)) { usable = false; break }
      slugByOption.set(value.optionId, value.slug)
    }
    if (!usable || slugByOption.size !== productOptions.length) { unresolvable++; continue }

    const query = buildVariationQuery(productOptions.map((o) => [o.paramKey, slugByOption.get(o.optionId) ?? null]))
    if (!query) { unresolvable++; continue }

    const url = `${productUrl(siteUrl, variant.parent_slug, urlStyle)}?${query}`
    if (seen.has(url)) continue
    seen.add(url)

    if (entries.length >= MAX_VARIATION_URLS) { truncated++; continue }
    entries.push({
      url,
      lastModified: variant.parent_updated_at,
      changeFrequency: 'weekly',
      // Below the listing's own 0.6: the bare product page is still the one to
      // rank for the range, and each combination is a narrower answer than it.
      priority: 0.4,
    })
  }

  if (truncated > 0) {
    console.warn(`[shop-variations sitemap] capped at ${MAX_VARIATION_URLS} variation URLs; ${truncated} more left out to stay inside the sitemap protocol's 50,000-URL limit.`)
  }
  if (unresolvable > 0) {
    console.warn(`[shop-variations sitemap] ${unresolvable} variation${unresolvable === 1 ? '' : 's'} left out: no unambiguous address (a half-described combination, or two options sharing a parameter name).`)
  }
  return entries
}
