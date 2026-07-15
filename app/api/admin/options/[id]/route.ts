import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { updateOption, deleteOption } from '@/modules/shop-variations/lib/db/options'

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  controlType: z.enum(['DROPDOWN', 'SWATCH', 'PILL']).optional(),
  position: z.number().int().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  await updateOption(id, parsed.data)
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
