import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getEditorPayload } from '@/modules/shop-variations/lib/variants-service'

// The deep-dive editor payload: options + values, bulk-grid variant rows with
// full child fields, and personalisation add-ons.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const { id } = await params
  const payload = await getEditorPayload(id)
  if (!payload) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  return NextResponse.json(payload)
}
