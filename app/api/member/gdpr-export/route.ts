import { NextRequest, NextResponse } from 'next/server'
import { verifyInternalExportBearer } from '@/lib/members/export'
import { listOrdersByMemberId, getOrderItems } from '@/modules/shop/lib/db/orders'

// Internal bearer only - called self-origin by core's assembleMemberExport()
// (memberExtensions.dataExportPath). Returns the member's personalisation inputs
// (engraving text, chosen options, upload links) captured on their orders. The
// data lives in each order line's saved meta, so this is a read over their
// orders rather than a separate store.
export async function GET(request: NextRequest) {
  if (!verifyInternalExportBearer(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const memberId = request.headers.get('x-cactus-member-id')
  if (!memberId) return NextResponse.json({ error: 'Missing member id' }, { status: 400 })

  const orders = await listOrdersByMemberId(memberId)
  const personalisation: Array<{ orderNumber: string; items: Array<{ productName: string; fields: unknown }> }> = []
  for (const order of orders) {
    const items = await getOrderItems(order.id)
    const personalised = items.filter((i) => i.lineMeta?.fields?.length)
    if (personalised.length > 0) {
      personalisation.push({ orderNumber: order.orderNumber, items: personalised.map((i) => ({ productName: i.productName, fields: i.lineMeta?.fields ?? [] })) })
    }
  }

  return NextResponse.json({ personalisation })
}
