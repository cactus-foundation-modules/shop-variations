import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getProductGalleryFlags, setProductGalleryFlags } from '@/modules/shop-variations/lib/db/product-gallery'

// How this product's own photographs sit against the variations promoted with
// "Image up front" - on the product page, and separately which picture the
// product shows in a grid. Read and written by the tick boxes this module
// contributes to the product editor's Images tab.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const { id } = await params
  return NextResponse.json(await getProductGalleryFlags(id))
}

// Both optional so a caller may set one flag without knowing the other's state -
// an omitted key keeps whatever is already saved rather than reading as "off".
const Body = z.object({
  baseImagesLast: z.boolean().optional(),
  cardImageFromVariation: z.boolean().optional(),
})

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  const current = await getProductGalleryFlags(id)
  await setProductGalleryFlags(id, {
    baseImagesLast: parsed.data.baseImagesLast ?? current.baseImagesLast,
    cardImageFromVariation: parsed.data.cardImageFromVariation ?? current.cardImageFromVariation,
  })
  return NextResponse.json({ ok: true })
}
