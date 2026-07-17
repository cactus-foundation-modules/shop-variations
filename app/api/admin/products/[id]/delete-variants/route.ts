import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { deleteVariants } from '@/modules/shop-variations/lib/variants-service'

const Body = z.object({ variantIds: z.array(z.string()).min(1) })

// Delete a chosen set of variants for a parent product - the grid's bulk-select
// delete. Each id is verified to belong to this parent inside the service, so
// only this product's rows can go. Gated on shop.products, like the single-row
// delete and clear-all it sits alongside.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  const removed = await deleteVariants(id, parsed.data.variantIds)
  return NextResponse.json({ removed })
}
