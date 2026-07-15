import { prisma } from '@/lib/db/prisma'

// Parent-grouped variant sales. Reads the shop's own paid order items, joined to
// their parent product through svr_variants.child_product_id, and rolls the
// numbers up under each parent with its best/worst-selling variant. Read-only;
// no shop change.
export type VariantSalesRow = { childId: string; name: string; units: number; revenue: number }
export type ParentSalesReport = {
  parentId: string
  parentName: string
  totalUnits: number
  totalRevenue: number
  variants: VariantSalesRow[]
  best: VariantSalesRow | null
  worst: VariantSalesRow | null
}

export async function getVariantSalesReport(): Promise<ParentSalesReport[]> {
  const rows = await prisma.$queryRaw<Array<{ parent_id: string; parent_name: string; child_id: string; child_name: string; units: bigint; revenue: unknown }>>`
    SELECT parent."id" AS parent_id, parent."name" AS parent_name,
           child."id" AS child_id, child."name" AS child_name,
           COALESCE(SUM(oi."quantity"), 0)::bigint AS units,
           COALESCE(SUM(oi."total"), 0) AS revenue
    FROM "svr_variants" v
    JOIN "shp_products" parent ON parent."id" = v."product_id"
    JOIN "shp_products" child ON child."id" = v."child_product_id"
    JOIN "shp_order_items" oi ON oi."product_id" = child."id"
    JOIN "shp_orders" o ON o."id" = oi."order_id" AND o."payment_status" = 'PAID'
    GROUP BY parent."id", parent."name", child."id", child."name"
  `

  const byParent = new Map<string, ParentSalesReport>()
  for (const r of rows) {
    let parent = byParent.get(r.parent_id)
    if (!parent) {
      parent = { parentId: r.parent_id, parentName: r.parent_name, totalUnits: 0, totalRevenue: 0, variants: [], best: null, worst: null }
      byParent.set(r.parent_id, parent)
    }
    const units = Number(r.units)
    const revenue = Number(r.revenue)
    const row: VariantSalesRow = { childId: r.child_id, name: r.child_name, units, revenue }
    parent.variants.push(row)
    parent.totalUnits += units
    parent.totalRevenue += revenue
  }

  const reports = [...byParent.values()]
  for (const parent of reports) {
    parent.variants.sort((a, b) => b.units - a.units)
    parent.best = parent.variants[0] ?? null
    parent.worst = parent.variants.length > 1 ? (parent.variants[parent.variants.length - 1] ?? null) : null
    parent.totalRevenue = Math.round((parent.totalRevenue + Number.EPSILON) * 100) / 100
  }
  reports.sort((a, b) => b.totalRevenue - a.totalRevenue)
  return reports
}
