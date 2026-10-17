// shop.cart-requirements provider: an option value that can only be bought with
// another (the 100cm extension of a reception desk needs one of the desks).
//
// The rule is stored on the value (svr_option_values.requires_value_ids, migration
// 019) as the ids of the values - on the same listing - of which any ONE must be in
// the basket. Shop marks every line this returns unavailable, which is what puts the
// reason and link under the line in the basket and makes the checkout refuse the
// order server-side; adding to the basket is never blocked, so a shopper can put the
// extension in first and be told what is missing.
//
// Arithmetic over one query: lines with no rule, which is nearly every line on a
// shop that never sets one, cost a single indexed read and return at once.
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { CartRequirementHit, CartRequirementLine } from '@/modules/shop/lib/cart-requirements'

type Row = {
  child_product_id: string
  parent_id: string
  value_id: string
  label: string
  requires_value_ids: unknown
}

function idList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

export async function cartRequirements(lines: CartRequirementLine[]): Promise<CartRequirementHit[]> {
  if (lines.length === 0) return []
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT v."child_product_id", v."product_id" AS parent_id, ov."id" AS value_id, ov."label", ov."requires_value_ids"
    FROM "svr_variants" v
    JOIN "svr_variant_values" vv ON vv."variant_id" = v."id"
    JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
    WHERE v."child_product_id" IN (${Prisma.join(lines.map((l) => l.product.id))})
  `
  if (!rows.some((r) => idList(r.requires_value_ids).length > 0)) return []

  // Every value each listing's basket lines carry: what a requirement is met from.
  const held = new Map<string, Set<string>>()
  for (const r of rows) {
    const set = held.get(r.parent_id) ?? new Set<string>()
    set.add(r.value_id)
    held.set(r.parent_id, set)
  }

  // Labels of the wanted values, and the listing to send the shopper back to.
  const wantedIds = [...new Set(rows.flatMap((r) => idList(r.requires_value_ids)))]
  const labels = new Map<string, string>()
  if (wantedIds.length > 0) {
    const found = await prisma.$queryRaw<{ id: string; label: string }[]>`
      SELECT "id", "label" FROM "svr_option_values" WHERE "id" IN (${Prisma.join(wantedIds)})
    `
    for (const f of found) labels.set(f.id, f.label)
  }
  const parentIds = [...new Set(rows.map((r) => r.parent_id))]
  const parents = await prisma.$queryRaw<{ id: string; name: string; slug: string }[]>`
    SELECT "id", "name", "slug" FROM "shp_products" WHERE "id" IN (${Prisma.join(parentIds)})
  `
  const parentById = new Map(parents.map((p) => [p.id, p]))

  const hits = new Map<string, CartRequirementHit>()
  for (const r of rows) {
    if (hits.has(r.child_product_id)) continue
    // Ids that no longer exist (a deleted value) are dropped, not waited for.
    const wanted = idList(r.requires_value_ids).filter((id) => labels.has(id))
    if (wanted.length === 0) continue
    const have = held.get(r.parent_id)
    if (have && wanted.some((id) => have.has(id))) continue
    const names = wanted.map((id) => labels.get(id)!)
    const parent = parentById.get(r.parent_id)
    hits.set(r.child_product_id, {
      productId: r.child_product_id,
      reason: `The ${r.label} can only be bought with ${names.length === 1 ? 'a' : 'one of'} ${names.join(' or ')}. Add ${names.length === 1 ? 'one' : 'one of them'} to your basket to check out.`,
      ...(parent ? { link: { href: `/${parent.slug}`, label: `Choose one: ${parent.name}` } } : {}),
    })
  }
  return [...hits.values()]
}
