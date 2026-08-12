import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getBaseImagesLast, setBaseImagesLast } from '@/modules/shop-variations/lib/db/product-gallery'

// How this product's own photographs sit against the variations promoted with
// "Image up front". Read and written by the tick box this module contributes to
// the product editor's Images tab.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const { id } = await params
  return NextResponse.json({ baseImagesLast: await getBaseImagesLast(id) })
}

const Body = z.object({ baseImagesLast: z.boolean() })

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  await setBaseImagesLast(id, parsed.data.baseImagesLast)
  return NextResponse.json({ ok: true })
}
