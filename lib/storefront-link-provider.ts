// The `shop.product-storefront-link` provider. Shop asks where some products
// live on the storefront - for the admin order screen, whose line names open
// the page the customer bought from - and this answers every variant child among
// them with its parent listing and the combination's own query string:
// `/desk?width=160cm&finish=walnut`.
//
// The query is spelt by variationCanonicalQuery (lib/url-selection.ts), the one
// function the sitemap, the canonical tag and the Google Shopping feed already
// share, so staff land on exactly the address a shopper would. Where the
// combination has no address of its own (an option left unanswered, two options
// sharing a parameter name) the child is left unanswered, and shop falls back to
// the child's own slug - which our product-page resolver still opens on that
// variation.
//
// The answer's shape is shop's contract (ProductStorefrontLink in
// modules/shop/lib/product-storefront-link.ts), written out here rather than
// imported so this module still builds against a shop that predates the point -
// an older shop simply never asks.
//
// Server-only: registered with `serverOnly: true`.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { variationCanonicalQuery, type VariationUrlOption } from '@/modules/shop-variations/lib/url-selection'

type StorefrontLink = { slug: string; query: string | null }

type VariantRow = { child_id: string; parent_id: string; parent_slug: string; value_ids: string[] }
type OptionRow = { product_id: string; option_id: string; option_name: string }
type ValueRow = { option_id: string; value_id: string; value_slug: string }

/** The pure half, so the address is testable without a database. */
export function buildStorefrontLinks(variants: VariantRow[], options: OptionRow[], values: ValueRow[]): Record<string, StorefrontLink> {
  const valuesByOption = new Map<string, Array<{ id: string; slug: string }>>()
  for (const row of values) {
    const list = valuesByOption.get(row.option_id) ?? []
    list.push({ id: row.value_id, slug: row.value_slug })
    valuesByOption.set(row.option_id, list)
  }
  // Options in display order, which is what decides which option claims a
  // parameter name - the same order getOptionsWithValues and the sitemap use.
  const optionsByProduct = new Map<string, VariationUrlOption[]>()
  for (const row of options) {
    const list = optionsByProduct.get(row.product_id) ?? []
    list.push({ id: row.option_id, name: row.option_name, values: valuesByOption.get(row.option_id) ?? [] })
    optionsByProduct.set(row.product_id, list)
  }

  const out: Record<string, StorefrontLink> = {}
  for (const variant of variants) {
    const query = variationCanonicalQuery(optionsByProduct.get(variant.parent_id) ?? [], variant.value_ids)
    if (query) out[variant.child_id] = { slug: variant.parent_slug, query }
  }
  return out
}

export async function shopVariationsStorefrontLinks(productIds: string[]): Promise<Record<string, StorefrontLink>> {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (ids.length === 0) return {}

  const variants = await prisma.$queryRaw<VariantRow[]>`
    SELECT sv."child_product_id" AS child_id,
           parent."id"           AS parent_id,
           parent."slug"         AS parent_slug,
           array_agg(svv."option_value_id") AS value_ids
    FROM "svr_variants" sv
    JOIN "shp_products" parent ON parent."id" = sv."product_id"
    JOIN "svr_variant_values" svv ON svv."variant_id" = sv."id"
    WHERE sv."child_product_id" IN (${Prisma.join(ids)})
    GROUP BY sv."id", sv."child_product_id", parent."id", parent."slug"
  `
  if (variants.length === 0) return {}

  const parentIds = [...new Set(variants.map((v) => v.parent_id))]
  const [options, values] = await Promise.all([
    prisma.$queryRaw<OptionRow[]>`
      SELECT "product_id", "id" AS option_id, "name" AS option_name
      FROM "svr_options"
      WHERE "product_id" IN (${Prisma.join(parentIds)})
      ORDER BY "position" ASC, "created_at" ASC
    `,
    prisma.$queryRaw<ValueRow[]>`
      SELECT ov."option_id", ov."id" AS value_id, ov."slug" AS value_slug
      FROM "svr_option_values" ov
      JOIN "svr_options" o ON o."id" = ov."option_id"
      WHERE o."product_id" IN (${Prisma.join(parentIds)})
    `,
  ])
  return buildStorefrontLinks(variants, options, values)
}
