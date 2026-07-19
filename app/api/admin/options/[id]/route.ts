import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { updateOption, deleteOption, getOptionProductId, optionNameTaken } from '@/modules/shop-variations/lib/db/options'

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  controlType: z.enum(['DROPDOWN', 'SWATCH', 'PILL', 'IMAGE']).optional(),
  position: z.number().int().optional(),
  requiresPreviousOption: z.boolean().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  // An option's name is not part of the generated variant child names (those are
  // composed from the value labels only), so a rename here needs no re-sync.
  const name = parsed.data.name?.trim()
  if (name !== undefined) {
    if (!name) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const productId = await getOptionProductId(id)
    if (!productId) return NextResponse.json({ error: 'Option not found' }, { status: 404 })
    if (await optionNameTaken(productId, name, id)) {
      return NextResponse.json({ error: `This product already has an option called "${name}".` }, { status: 409 })
    }
  }

  // A rename here is always the owner's own choice, so it counts as an override:
  // a later refresh stops offering the source's name back, and the same source
  // can sit on the product twice under two different names.
  await updateOption(id, {
    ...parsed.data,
    ...(name !== undefined ? { name, nameOverridden: true } : {}),
  })
  return NextResponse.json({ ok: true })
}

// Deleting an option cascades its values, and any variant that used those values
// is rebuilt on the next generate-matrix. Child products for now-impossible
// combinations are cleaned by that regenerate.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteOption(id)
  return NextResponse.json({ ok: true })
}
