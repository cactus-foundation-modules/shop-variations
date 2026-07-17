import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { createSingleVariant } from '@/modules/shop-variations/lib/variants-service'

const Body = z.object({ optionValueIds: z.array(z.string()).min(1) })

// Create one variant for a hand-picked combination of option values. The service
// checks the combination is complete (one value per option) and not a duplicate,
// then reorders the whole set so the new row sits where a full auto-generate would
// have put it. Gated on shop.products, like the matrix build it sits beside.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  try {
    const { variantId } = await createSingleVariant(id, parsed.data.optionValueIds)
    return NextResponse.json({ variantId }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not create that variant' }, { status: 400 })
  }
}
