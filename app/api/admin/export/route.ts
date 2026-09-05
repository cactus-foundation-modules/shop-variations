import { NextRequest, NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { exportVariationsCsv } from '@/modules/shop-variations/lib/csv'

// Downloads every variation (one row per variant) as CSV - the same shape the
// importer accepts, so it round-trips.
//
// `?columns=Variant SKU,Price` narrows it to the columns picked in the export
// modal. An absent or empty list means the whole grid, so an old bookmark still
// downloads exactly what it always did.
export async function GET(request: NextRequest) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const requested = request.nextUrl.searchParams.get('columns')
  const columns = requested ? requested.split(',').map((c) => c.trim()).filter(Boolean) : undefined
  const csv = await exportVariationsCsv(columns)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="product-variations.csv"',
    },
  })
}
