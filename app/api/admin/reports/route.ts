import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getVariantSalesReport } from '@/modules/shop-variations/lib/reports'

export async function GET() {
  const gate = await requireShopUser('shop.reports', { allowAccess: true })
  if (gate.error) return gate.error
  const report = await getVariantSalesReport()
  return NextResponse.json({ report })
}
