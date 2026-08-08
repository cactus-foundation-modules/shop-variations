import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { updateOption, deleteOption, getOptionProductId, optionNameTaken } from '@/modules/shop-variations/lib/db/options'

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  controlType: z.enum(['DROPDOWN', 'SWATCH', 'PILL', 'IMAGE']).optional(),
  position: z.number().int().optional(),
  requiresPreviousOption: z.boolean().optional(),
  cardDisplay: z.boolean().optional(),
  // Both nullable on purpose: null clears the override (back to the option's own
  // name) or the cap (back to showing every value), which is how the editor's
  // empty box is sent. Omitted leaves whatever is stored alone.
  cardLabel: z.string().max(80).nullable().optional(),
  cardLimit: z.number().int().min(1).max(50).nullable().optional(),
  // Fill exactly N lines of the tile instead of a fixed count. The editor sends
  // the two as a pair (setting one clears the other), but each stands alone here.
  cardFitLines: z.number().int().min(1).max(6).nullable().optional(),
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
  // A blank card label is not a label, it is the owner clearing the override, so
  // it is stored as null rather than as an empty string the card would then print
  // in front of the swatches.
  const cardLabel = parsed.data.cardLabel?.trim()
  await updateOption(id, {
    ...parsed.data,
    ...(name !== undefined ? { name, nameOverridden: true } : {}),
    ...(parsed.data.cardLabel !== undefined ? { cardLabel: cardLabel || null } : {}),
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
