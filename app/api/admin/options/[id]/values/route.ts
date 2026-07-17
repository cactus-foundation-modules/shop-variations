import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { createOptionValue, getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { fileSwatchImage } from '@/modules/shop-variations/lib/media-folder'
import { SWATCH_MAX_LENGTH } from '@/modules/shop-variations/lib/types'
import { prisma } from '@/lib/db/prisma'

const Body = z.object({ label: z.string().min(1).max(80), swatch: z.string().max(SWATCH_MAX_LENGTH).nullable().optional() })

// Add a value to an option. Position is appended after existing values.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  // Look up the owning product to count sibling values for the new position.
  const optionRow = await prisma.$queryRaw<{ product_id: string }[]>`SELECT "product_id" FROM "svr_options" WHERE "id" = ${id} LIMIT 1`
  if (!optionRow[0]) return NextResponse.json({ error: 'Option not found' }, { status: 404 })
  const option = (await getOptionsWithValues(optionRow[0].product_id)).find((o) => o.id === id)
  const value = await createOptionValue(id, parsed.data.label, parsed.data.swatch ?? null, option?.values.length ?? 0)

  // File an image-swatch picture in the product's colours folder (a no-op for a
  // hex colour swatch or an externally-hosted url).
  if (parsed.data.swatch) await fileSwatchImage(optionRow[0].product_id, value.id, parsed.data.swatch)

  return NextResponse.json({ id: value.id }, { status: 201 })
}
