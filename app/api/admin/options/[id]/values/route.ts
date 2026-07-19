import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getSessionFromCookie } from '@/lib/auth/session'
import {
  createOptionValue,
  getOptionWithValues,
  optionValueLabelTaken,
} from '@/modules/shop-variations/lib/db/options'
import { fileSwatchImage } from '@/modules/shop-variations/lib/media-folder'
import { resolveOptionSourceProvider } from '@/modules/shop-variations/lib/option-sources'
import { SWATCH_MAX_LENGTH } from '@/modules/shop-variations/lib/types'
import { prisma } from '@/lib/db/prisma'

// Two ways to add a value, and they are deliberately exclusive.
//
//   { label, swatch }  - typed in by hand. Owns itself, has no source ref, and a
//                        later refresh leaves it alone.
//   { valueRefs }      - taken from the option's own source. Which values exist
//                        is the source's business, so only the refs come from
//                        the browser; the labels and swatches are read back from
//                        the provider server-side, exactly as option creation
//                        does it. A posted label would let the browser invent a
//                        value the source has never heard of and still have it
//                        marked as sourced.
//
// This is the counterpart to Refresh, not a duplicate of it: Refresh brings in
// everything the source has, whereas this brings in the few the owner picks. A
// product sold in three of an attribute's thirty colours needs the second.
const Body = z.union([
  z.object({
    label: z.string().min(1).max(80),
    swatch: z.string().max(SWATCH_MAX_LENGTH).nullable().optional(),
  }),
  z.object({ valueRefs: z.array(z.string().min(1).max(200)).min(1) }),
])

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  // Look up the owning product to count sibling values for the new position.
  const optionRow = await prisma.$queryRaw<{ product_id: string }[]>`SELECT "product_id" FROM "svr_options" WHERE "id" = ${id} LIMIT 1`
  if (!optionRow[0]) return NextResponse.json({ error: 'Option not found' }, { status: 404 })
  const productId = optionRow[0].product_id

  if ('valueRefs' in parsed.data) {
    return addFromSource(id, productId, parsed.data.valueRefs)
  }

  const option = await getOptionWithValues(id)
  const value = await createOptionValue(id, parsed.data.label, parsed.data.swatch ?? null, option?.values.length ?? 0)

  // File an image-swatch picture in the product's colours folder (a no-op for a
  // hex colour swatch or an externally-hosted url).
  if (parsed.data.swatch) await fileSwatchImage(productId, value.id, parsed.data.swatch)

  return NextResponse.json({ id: value.id }, { status: 201 })
}

/**
 * Copy picked values across from the option's source.
 *
 * Skips rather than fails on the two collisions that matter, because the owner
 * ticking five values should not have the lot rejected over one of them:
 *   - a ref already copied here, so ticking it twice is harmless
 *   - a label already used on this option by hand, which would make the
 *     generated variant names ambiguous (the same bar rename and refresh apply)
 * Both are counted and handed back so the UI can say what happened.
 */
async function addFromSource(optionId: string, productId: string, valueRefs: string[]) {
  const option = await getOptionWithValues(optionId)
  if (!option) return NextResponse.json({ error: 'Option not found' }, { status: 404 })
  if (!option.sourceProvider || !option.sourceRef) {
    return NextResponse.json({ error: 'That option was not built from a source.' }, { status: 400 })
  }

  const user = await getSessionFromCookie()
  const provider = await resolveOptionSourceProvider(option.sourceProvider, user)
  if (!provider) return NextResponse.json({ error: 'That source is not available.' }, { status: 400 })
  const source = await provider.getSource(option.sourceRef)
  if (!source) return NextResponse.json({ error: 'That source no longer exists.' }, { status: 400 })

  const wanted = new Set(valueRefs)
  const alreadyHave = new Set(option.values.map((v) => v.sourceRef).filter(Boolean) as string[])
  const incoming = source.values.filter((v) => wanted.has(v.ref) && !alreadyHave.has(v.ref))
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'Those values are already on this option.' }, { status: 400 })
  }

  let position = option.values.reduce((max, v) => Math.max(max, v.position + 1), 0)
  const added: string[] = []
  const skipped: string[] = []
  for (const v of incoming) {
    if (await optionValueLabelTaken(optionId, v.label, '')) { skipped.push(v.label); continue }
    const created = await createOptionValue(optionId, v.label, v.swatch ?? null, position, v.ref)
    if (v.swatch) await fileSwatchImage(productId, created.id, v.swatch)
    position += 1
    added.push(v.label)
  }

  return NextResponse.json({ added: added.length, skipped }, { status: 201 })
}
