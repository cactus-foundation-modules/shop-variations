import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { updateOptionValue, deleteOptionValue, getOptionValueOwner, getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { fileSwatchImage } from '@/modules/shop-variations/lib/media-folder'
import { syncVariantChildNames } from '@/modules/shop-variations/lib/variants-service'
import { SWATCH_MAX_LENGTH } from '@/modules/shop-variations/lib/types'

const PatchBody = z.object({
  label: z.string().min(1).max(80).optional(),
  swatch: z.string().max(SWATCH_MAX_LENGTH).nullable().optional(),
  position: z.number().int().optional(),
  // Other values on the same listing, any one of which must be in the basket.
  requiresValueIds: z.array(z.string().max(64)).max(50).optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const owner = await getOptionValueOwner(id)
  if (!owner) return NextResponse.json({ error: 'Value not found' }, { status: 404 })

  // Duplicate labels are allowed on purpose: two values may both read "Black"
  // (different swatches), told apart by their slugs. The slug itself is not
  // editable here - it stays put through a rename so sheets and sources keep
  // resolving the same value.
  const label = parsed.data.label?.trim()
  if (label !== undefined && !label) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  // A hand-edited swatch drops both shrunk copies rather than keeping ones made
  // from the PREVIOUS picture: this module never makes the files itself (a
  // source module does), so a stale copy showing the old picture is the only
  // thing keeping them could mean. The storefront falls back to the new swatch.
  // A requirement can only name another value of the same listing - never itself,
  // never a value of some other product (it could never be in this basket line's
  // listing, and would leave the value unbuyable for ever).
  let requiresValueIds: string[] | undefined
  if (parsed.data.requiresValueIds !== undefined) {
    const own = new Set((await getOptionsWithValues(owner.productId)).flatMap((o) => o.values.map((v) => v.id)))
    requiresValueIds = [...new Set(parsed.data.requiresValueIds)].filter((v) => v !== id && own.has(v))
  }

  await updateOptionValue(id, {
    ...parsed.data,
    ...(requiresValueIds !== undefined ? { requiresValueIds } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(parsed.data.swatch !== undefined ? { swatchSmall: null, swatchTiny: null } : {}),
  })

  // An image-swatch picture (the only swatch that is a media url; a colour swatch
  // is a bare hex) is filed in the product's colours folder. The helper is a
  // no-op for a hex or externally-hosted value.
  if (parsed.data.swatch) await fileSwatchImage(owner.productId, id, parsed.data.swatch)

  // A renamed value invalidates the name of every variant child that uses it, so
  // re-compose them all rather than tracking which ones changed.
  if (label !== undefined) await syncVariantChildNames(owner.productId)

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteOptionValue(id)
  return NextResponse.json({ ok: true })
}
