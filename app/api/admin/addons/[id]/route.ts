import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { updateAddon, deleteAddon } from '@/modules/shop-variations/lib/db/addons'

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

const PatchBody = z.object({
  label: z.string().min(1).max(120).optional(),
  required: z.boolean().optional(),
  position: z.number().int().optional(),
  config: ConfigSchema.optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  await updateAddon(id, parsed.data)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  await deleteAddon(id)
  return NextResponse.json({ ok: true })
}
