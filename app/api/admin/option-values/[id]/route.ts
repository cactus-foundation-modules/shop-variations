import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { updateOptionValue, deleteOptionValue, getOptionValueOwner, optionValueLabelTaken } from '@/modules/shop-variations/lib/db/options'
import { syncVariantChildNames } from '@/modules/shop-variations/lib/variants-service'
import { SWATCH_MAX_LENGTH } from '@/modules/shop-variations/lib/types'

const PatchBody = z.object({
  label: z.string().min(1).max(80).optional(),
  swatch: z.string().max(SWATCH_MAX_LENGTH).nullable().optional(),
  position: z.number().int().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const owner = await getOptionValueOwner(id)
  if (!owner) return NextResponse.json({ error: 'Value not found' }, { status: 404 })

  const label = parsed.data.label?.trim()
  if (label !== undefined) {
    if (!label) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    if (await optionValueLabelTaken(owner.optionId, label, id)) {
      return NextResponse.json({ error: `This option already has a value called "${label}".` }, { status: 409 })
    }
  }

  await updateOptionValue(id, { ...parsed.data, ...(label !== undefined ? { label } : {}) })

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
