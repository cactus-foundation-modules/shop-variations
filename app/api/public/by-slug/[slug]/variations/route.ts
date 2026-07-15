import { NextResponse } from 'next/server'
import { getVariantSelectorPayloadBySlug } from '@/modules/shop-variations/lib/variants-service'

// Public storefront selector payload, looked up by the product slug the product
// page already has in its URL. Exposes only what a shopper already sees: option
// controls, each variant's live price/stock/image, the parent's base images, and
// the personalisation add-on definitions. 404s for an unknown or hidden product.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const payload = await getVariantSelectorPayloadBySlug(slug)
  if (!payload) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  return NextResponse.json(payload)
}
