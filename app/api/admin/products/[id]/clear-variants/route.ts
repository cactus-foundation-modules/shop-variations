import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { clearVariants } from '@/modules/shop-variations/lib/variants-service'

// Delete every variant + child product for a parent. Options and add-ons stay.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const removed = await clearVariants(id)
  return NextResponse.json({ removed })
}
