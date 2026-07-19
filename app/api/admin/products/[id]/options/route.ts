import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getSessionFromCookie } from '@/lib/auth/session'
import { createOption, createOptionValue, getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { fileSwatchImage } from '@/modules/shop-variations/lib/media-folder'
import { resolveOptionSourceProvider } from '@/modules/shop-variations/lib/option-sources'
import { SWATCH_MAX_LENGTH } from '@/modules/shop-variations/lib/types'

const Body = z.object({
  name: z.string().min(1).max(80),
  controlType: z.enum(['DROPDOWN', 'SWATCH', 'PILL', 'IMAGE']).default('DROPDOWN'),
  values: z.array(z.object({ label: z.string().min(1).max(80), swatch: z.string().max(SWATCH_MAX_LENGTH).nullable().optional() })).optional(),
  // Build the option from a source module instead of from typed-in values. The
  // refs are the provider's own; `valueRefs` is which of the source's values to
  // take, so the owner can bring across three colours out of thirty.
  source: z
    .object({
      provider: z.string().min(1).max(120),
      ref: z.string().min(1).max(200),
      valueRefs: z.array(z.string().min(1).max(200)).min(1),
    })
    .optional(),
})

// Create an option (optionally with its initial values) on a parent product.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  const { name, controlType, source } = parsed.data

  // A sourced option reads its own values back from the provider rather than
  // trusting labels posted by the browser, so what lands in the database is
  // whatever the source actually says right now. Only the picked refs, the
  // option name and the control type come from the client.
  let values: { label: string; swatch: string | null; sourceRef: string | null }[]
  if (source) {
    const user = await getSessionFromCookie()
    const provider = await resolveOptionSourceProvider(source.provider, user)
    if (!provider) return NextResponse.json({ error: 'That source is not available.' }, { status: 400 })
    const resolved = await provider.getSource(source.ref)
    if (!resolved) return NextResponse.json({ error: 'That source no longer exists.' }, { status: 400 })

    const wanted = new Set(source.valueRefs)
    values = resolved.values
      .filter((v) => wanted.has(v.ref))
      .map((v) => ({ label: v.label, swatch: v.swatch ?? null, sourceRef: v.ref }))
    if (values.length === 0) return NextResponse.json({ error: 'None of those values exist any more.' }, { status: 400 })
  } else {
    values = (parsed.data.values ?? []).map((v) => ({ label: v.label, swatch: v.swatch ?? null, sourceRef: null }))
  }

  const existing = await getOptionsWithValues(id)
  const option = await createOption(id, name, controlType, existing.length, source ? { provider: source.provider, ref: source.ref } : null)

  let pos = 0
  for (const v of values) {
    const value = await createOptionValue(option.id, v.label, v.swatch, pos, v.sourceRef)
    // File an image-swatch picture in the product's colours folder (a no-op for
    // a hex colour swatch or an externally-hosted url).
    if (v.swatch) await fileSwatchImage(id, value.id, v.swatch)
    pos += 1
  }

  return NextResponse.json({ id: option.id }, { status: 201 })
}
