// The custom RAL colour on a basket line: which of the line's options are RAL
// options with their custom choice picked, and whether the code the browser sent
// for each is a real chart colour that is not already one of the suggestions.
//
// Server-only (reads the database). Called by the cart-line resolver for every
// variation line, so the lookup is batched the same way addon-cache and
// variant-title-cache are: shop's prefetch hook hands over the whole cart and one
// query answers every line, with a per-line fallback when no prefetch ran.
import { cache } from 'react'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { LineMetaField, ShpProduct } from '@/modules/shop/lib/types'
import { ralLabel } from '@/modules/shop-variations/lib/ral-classic'
import { checkCustomRal, customRalMeta, ralOptionParts } from '@/modules/shop-variations/lib/ral-option'

// One RAL option on one variation child: its values in the owner's order, and
// which of them this child carries.
type RalOptionOnChild = {
  optionId: string
  optionName: string
  values: { id: string; label: string }[]
  carriedValueId: string | null
}

type RalStore = { byChild: Map<string, RalOptionOnChild[]>; prefetched: boolean }

const requestStore = cache((): RalStore => ({ byChild: new Map(), prefetched: false }))

// Every RAL option on the parents of these children, with the value each child
// carries. One query for the whole set. Children with no RAL option simply do
// not appear.
async function loadRalOptions(childIds: string[]): Promise<Map<string, RalOptionOnChild[]>> {
  const byChild = new Map<string, RalOptionOnChild[]>()
  if (childIds.length === 0) return byChild
  const rows = await prisma.$queryRaw<{ child_product_id: string; option_id: string; option_name: string; value_id: string; label: string; carried: boolean }[]>`
    SELECT vr."child_product_id", o."id" AS option_id, o."name" AS option_name,
           ov."id" AS value_id, ov."label", (vv."option_value_id" IS NOT NULL) AS carried
    FROM "svr_variants" vr
    JOIN "svr_options" o ON o."product_id" = vr."product_id" AND o."control_type" = 'RAL'
    JOIN "svr_option_values" ov ON ov."option_id" = o."id"
    LEFT JOIN "svr_variant_values" vv ON vv."variant_id" = vr."id" AND vv."option_value_id" = ov."id"
    WHERE vr."child_product_id" IN (${Prisma.join(childIds)})
    ORDER BY vr."child_product_id", o."position", ov."position"
  `
  for (const row of rows) {
    const list = byChild.get(row.child_product_id) ?? []
    let option = list.find((o) => o.optionId === row.option_id)
    if (!option) {
      option = { optionId: row.option_id, optionName: row.option_name, values: [], carriedValueId: null }
      list.push(option)
      byChild.set(row.child_product_id, list)
    }
    option.values.push({ id: row.value_id, label: row.label })
    if (row.carried) option.carriedValueId = row.value_id
  }
  return byChild
}

export async function prefetchRalLines(products: ShpProduct[]): Promise<void> {
  const store = requestStore()
  const children = products.filter((p) => p.catalogueHidden).map((p) => p.id)
  const found = await loadRalOptions(children)
  for (const id of children) store.byChild.set(id, found.get(id) ?? [])
  store.prefetched = true
}

async function ralOptionsForChild(product: ShpProduct): Promise<RalOptionOnChild[]> {
  if (!product.catalogueHidden) return []
  const store = requestStore()
  const cached = store.byChild.get(product.id)
  if (cached) return cached
  const found = (await loadRalOptions([product.id])).get(product.id) ?? []
  store.byChild.set(product.id, found)
  return found
}

export type RalLineResult = { valid: boolean; reason?: string; fields: LineMetaField[] }

// What the line's custom RAL choices come to: a field per option for the order
// line ("Frame colour: RAL 5015 Sky blue (custom)"), or refused with a reason the
// basket can show when a custom choice arrived without a usable code. Never
// trusts the browser beyond the code itself - which options are custom, and what
// counts as a suggestion, come from the database.
export async function resolveRalLine(product: ShpProduct, meta: Record<string, unknown> | undefined): Promise<RalLineResult> {
  const options = await ralOptionsForChild(product)
  if (options.length === 0) return { valid: true, fields: [] }
  const sent = customRalMeta(meta)
  const fields: LineMetaField[] = []
  for (const option of options) {
    const parts = ralOptionParts({ controlType: 'RAL', values: option.values })
    if (!parts?.custom || option.carriedValueId !== parts.custom.id) continue
    const check = checkCustomRal(parts, sent[option.optionId])
    if (!check.ok) {
      return { valid: false, reason: `Choose a RAL colour for ${option.optionName.toLowerCase()}`, fields: [] }
    }
    fields.push({ label: option.optionName, value: `${ralLabel(check.colour)} (custom)` })
  }
  return { valid: true, fields }
}
