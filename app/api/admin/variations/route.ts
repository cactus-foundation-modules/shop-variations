import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getVariationsList } from '@/modules/shop-variations/lib/variations-list'

// Cross-product variations list for the Variations tab on Shop > Products. Every
// variant across every product, with its image, option-value label, price/SKU/
// stock and any contributed columns (3D file, attributes). Filterable by product,
// by missing image, and by a missing contributed column. Gated like the product
// editor's Variations tab it complements.
export async function GET(request: Request) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error

  const { searchParams } = new URL(request.url)
  const pageParam = Number(searchParams.get('page'))
  const perPageParam = Number(searchParams.get('perPage'))

  const result = await getVariationsList(
    {
      productId: searchParams.get('product') || undefined,
      search: searchParams.get('search') || undefined,
      missing: searchParams.get('missing') || undefined,
      page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : undefined,
      perPage: Number.isFinite(perPageParam) && perPageParam > 0 ? perPageParam : undefined,
    },
    gate.user,
  )
  return NextResponse.json(result)
}
