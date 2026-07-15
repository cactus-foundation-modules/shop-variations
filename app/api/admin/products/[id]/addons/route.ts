import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { createAddon, getAddons } from '@/modules/shop-variations/lib/db/addons'

const ConfigSchema = z.object({
  placeholder: z.string().max(200).optional(),
  helpText: z.string().max(500).optional(),
  maxLength: z.number().int().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  flatPrice: z.number().nonnegative().optional(),
  pricePerChar: z.number().nonnegative().optional(),
  choices: z.array(z.object({ label: z.string().min(1), value: z.string().min(1), price: z.number().nonnegative().optional() })).optional(),
  maxFileMb: z.number().positive().optional(),
  allowedTypes: z.string().max(500).optional(),
}).strict()

const Body = z.object({
  type: z.enum(['TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'CHECKBOX', 'DATE', 'FILE']),
  label: z.string().min(1).max(120),
  required: z.boolean().default(false),
  config: ConfigSchema.default({}),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  const existing = await getAddons(id)
  const addon = await createAddon(id, { ...parsed.data, position: existing.length })
  return NextResponse.json({ id: addon.id }, { status: 201 })
}
