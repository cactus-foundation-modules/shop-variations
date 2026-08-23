// A variation child's name and web address are both composed from the listing
// they belong to: "<parent name> - <value> / <value>" and
// "<parent slug>-<value>-<value>".
//
// Both are snapshotted when the matrix is generated, so a listing renamed or
// re-addressed afterwards left its variations quoting the old one. That is not
// only untidy: the basket links each line at the child's own address (shop's
// product-page-resolver turns it back into the listing opened on that
// combination), so a shopper adding a variation to their basket saw a web
// address for a product name that no longer exists anywhere on the site.
//
// The address is built from the PARENT'S SLUG rather than from the child's
// composed name, so a listing whose address was tidied by hand - an SEO rewrite,
// say - takes its variations with it instead of leaving them on a spelling of
// the old name.
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { slugify, ensureUniqueProductSlug } from '@/modules/shop/lib/slug'
import { getProductById } from '@/modules/shop/lib/db/products'
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { getVariants, getVariantValueMap } from '@/modules/shop-variations/lib/db/variants'

/** "<parent name> - <value> / <value>" - the spelling every creation path uses. */
export function variantChildName(parentName: string, labels: string[]): string {
  return `${parentName} - ${labels.join(' / ')}`
}

/**
 * "<parent slug>-<value>-<value>".
 *
 * Deliberately NOT capped at generateSlug's 100 characters. That cap is sized
 * for a listing title; on a variation it lands mid-combination and lops the
 * values off the end, which is exactly what tells two variations apart - 5,281
 * of Deskwell's 20,366 combinations are longer than that, and truncating them
 * collapses 2,531 into "-2"/"-3" duplicates of each other. A long address on a
 * page nobody types by hand is the lesser problem.
 */
export function variantChildSlug(parentSlug: string, labels: string[]): string {
  const tail = labels.map((l) => slugify(l)).filter(Boolean).join('-')
  const base = tail ? `${parentSlug}-${tail}` : parentSlug
  return base.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'item'
}

type Planned = { childId: string; name: string; slug: string }

/**
 * Put every one of this listing's variation children back in step with it:
 * names and addresses recomposed from the parent and the current option value
 * labels. Idempotent - a matrix already in step costs one read and no writes.
 *
 * Returns how many children were renamed and how many were re-addressed.
 */
export async function syncVariantChildIdentity(parentId: string): Promise<{ renamed: number; reslugged: number }> {
  // Cheapest question first, and by a distance the commonest answer: this is
  // fired from every product write there is, and the overwhelming majority of
  // them are for a product with no variations at all - a plain listing, or one
  // of the variation children themselves. One indexed read and out.
  const variants = await getVariants(parentId)
  if (variants.length === 0) return { renamed: 0, reslugged: 0 }

  const parent = await getProductById(parentId)
  if (!parent) return { renamed: 0, reslugged: 0 }

  const options = await getOptionsWithValues(parentId)
  const labelByValueId = new Map<string, string>()
  const optionOrderByValueId = new Map<string, number>()
  options.forEach((o, oi) => o.values.forEach((v) => {
    labelByValueId.set(v.id, v.label)
    optionOrderByValueId.set(v.id, oi)
  }))

  const valueMap = await getVariantValueMap(parentId)

  const current = new Map<string, { name: string; slug: string }>()
  const childRows = await prisma.$queryRaw<{ id: string; name: string; slug: string }[]>`
    SELECT "id", "name", "slug" FROM "shp_products" WHERE "id" IN (${Prisma.join(variants.map((v) => v.childProductId))})
  `
  for (const r of childRows) current.set(r.id, { name: r.name, slug: r.slug })

  const planned: Planned[] = []
  for (const variant of variants) {
    const ids = (valueMap[variant.id] ?? []).slice()
      .sort((a, b) => (optionOrderByValueId.get(a) ?? 0) - (optionOrderByValueId.get(b) ?? 0))
    const labels = ids.map((id) => labelByValueId.get(id)).filter((l): l is string => Boolean(l))
    if (labels.length === 0) continue
    planned.push({
      childId: variant.childProductId,
      name: variantChildName(parent.name, labels),
      slug: variantChildSlug(parent.slug, labels),
    })
  }

  const changed = planned.filter((p) => {
    const now = current.get(p.childId)
    return now != null && (now.name !== p.name || now.slug !== p.slug)
  })
  if (changed.length === 0) return { renamed: 0, reslugged: 0 }

  const renamed = changed.filter((p) => current.get(p.childId)?.name !== p.name).length
  const reslugged = changed.filter((p) => current.get(p.childId)?.slug !== p.slug).length

  // Two phases, because one child routinely wants the address another is still
  // holding (swap two option labels round and every child in the matrix shifts
  // by one). Parking the whole set on a per-id placeholder first clears the way,
  // so the second pass never trips shp_products_slug_key against itself.
  try {
    await prisma.$transaction(async (tx) => {
      await parkOnPlaceholders(tx, changed)
      for (const chunk of chunked(changed, 500)) {
        const values = Prisma.join(chunk.map((p) => Prisma.sql`(${p.childId}, ${p.name}, ${p.slug})`))
        await tx.$executeRaw`
          UPDATE "shp_products" AS c
          SET "name" = v."name", "slug" = v."slug", "updated_at" = CURRENT_TIMESTAMP
          FROM (VALUES ${values}) AS v("id", "name", "slug")
          WHERE c."id" = v."id"
        `
      }
    })
  } catch (err) {
    if (!isSlugCollision(err)) throw err
    // The batch is all-or-nothing, so nothing was written; redo it one child at
    // a time, each address walked past whatever is holding it.
    await prisma.$transaction(async (tx) => { await parkOnPlaceholders(tx, changed) })
    await repairCollisions(changed)
  }

  return { renamed, reslugged }
}

// Just the one method, so both the client and an interactive transaction's
// handle satisfy it (the extended client's own type is not assignable to
// Prisma.TransactionClient).
type Tx = Pick<typeof prisma, '$executeRaw'>

/** Park every changing child on an address nothing else can be holding, so the
 *  real write never collides with the set's own old addresses. */
async function parkOnPlaceholders(tx: Tx, changed: Planned[]): Promise<void> {
  await tx.$executeRaw`
    UPDATE "shp_products" SET "slug" = 'tmpslug-' || "id"
    WHERE "id" IN (${Prisma.join(changed.map((p) => p.childId))})
  `
}

function isSlugCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (err.code === 'P2002') return true
  return err.code === 'P2010' && String(err.meta?.message ?? '').includes('unique constraint')
}

/** The rare path: a wanted address is already held by some other product (two
 *  listings whose names run into each other - "Desk Pro" + "2" against "Desk" +
 *  "Pro 2"). Walked one at a time through the same "-2"/"-3" helper the editor
 *  uses, so the answer matches what creating that variation by hand would give. */
async function repairCollisions(planned: Planned[]): Promise<void> {
  for (const p of planned) {
    const slug = await ensureUniqueProductSlug(p.slug, p.childId)
    await prisma.$executeRaw`
      UPDATE "shp_products" SET "name" = ${p.name}, "slug" = ${slug}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${p.childId}
    `
  }
}

function chunked<T>(rows: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

/**
 * `shop.product-saved` listener. Shop tells us which fields a write carried, so
 * the overwhelming majority of saves - a price, a stock count, a description -
 * cost nothing but the array check. A renamed or re-addressed listing takes its
 * variations with it, which is what makes the editor's "Rebuild web address"
 * button reach them.
 */
export async function syncVariationsIdentityOnProductSaved(productId: string, changed: readonly string[]): Promise<void> {
  if (!changed.includes('name') && !changed.includes('slug')) return
  await syncVariantChildIdentity(productId)
}
