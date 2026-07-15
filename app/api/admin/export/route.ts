import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { exportVariationsCsv } from '@/modules/shop-variations/lib/csv'

// Downloads every variation (one row per variant) as CSV - the same shape the
// importer accepts, so it round-trips.
export async function GET() {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const csv = await exportVariationsCsv()
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="product-variations.csv"',
    },
  })
}
