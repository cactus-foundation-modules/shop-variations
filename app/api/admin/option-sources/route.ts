import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getSessionFromCookie } from '@/lib/auth/session'
import { resolveOptionSourceProviders, suggestControlType } from '@/modules/shop-variations/lib/option-sources'

// Everything the "add from a source" picker can offer, flattened for the client:
// each provider with its sources, each source with its values and the control
// type those values suggest. One round trip, because the picker needs the values
// up front to let the shop owner tick the ones they want.
//
// Returns an empty list when no module contributes a source, which is what makes
// the button disappear rather than open an empty dialog.
export async function GET() {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const user = await getSessionFromCookie()
  const providers = await resolveOptionSourceProviders(user)

  const out = []
  for (const { id, provider } of providers) {
    const sources = await provider.listSources()
    out.push({
      id,
      label: provider.label,
      sources: sources
        .filter((s) => s.values.length > 0)
        .map((s) => ({
          ref: s.ref,
          name: s.name,
          groupLabel: s.groupLabel ?? null,
          suggestedControlType: suggestControlType(s.values),
          values: s.values.map((v) => ({ ref: v.ref, label: v.label, swatch: v.swatch })),
        })),
    })
  }

  return NextResponse.json({ providers: out.filter((p) => p.sources.length > 0) })
}
