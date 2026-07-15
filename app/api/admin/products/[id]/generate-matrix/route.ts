import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { generateMatrix } from '@/modules/shop-variations/lib/variants-service'

// (Re)build the variant matrix - creates/removes hidden child products for the
// delta, preserving existing rows. Gated on shop.products.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  try {
    const result = await generateMatrix(id)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not generate variants' }, { status: 400 })
  }
}
