import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { createOption, createOptionValue, getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { SWATCH_MAX_LENGTH } from '@/modules/shop-variations/lib/types'

const Body = z.object({
  name: z.string().min(1).max(80),
  controlType: z.enum(['DROPDOWN', 'SWATCH', 'PILL', 'IMAGE']).default('DROPDOWN'),
  values: z.array(z.object({ label: z.string().min(1).max(80), swatch: z.string().max(SWATCH_MAX_LENGTH).nullable().optional() })).optional(),
})

// Create an option (optionally with its initial values) on a parent product.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  const existing = await getOptionsWithValues(id)
  const option = await createOption(id, parsed.data.name, parsed.data.controlType, existing.length)
  if (parsed.data.values) {
    let pos = 0
    for (const v of parsed.data.values) {
      await createOptionValue(option.id, v.label, v.swatch ?? null, pos)
      pos += 1
    }
  }
  return NextResponse.json({ id: option.id }, { status: 201 })
}
