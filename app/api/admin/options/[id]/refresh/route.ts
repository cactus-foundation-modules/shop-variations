import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getSessionFromCookie } from '@/lib/auth/session'
import { getOptionWithValues } from '@/modules/shop-variations/lib/db/options'
import { fileSwatchImage } from '@/modules/shop-variations/lib/media-folder'
import { resolveOptionSourceProvider } from '@/modules/shop-variations/lib/option-sources'
import { OptionSourceGoneError, refreshOptionFromSource } from '@/modules/shop-variations/lib/option-refresh'
import { syncVariantChildNames } from '@/modules/shop-variations/lib/variants-service'

// Re-read a sourced option from the module that supplied it: new values in,
// renamed ones brought up to date, nothing deleted. See lib/option-refresh.ts
// for why removal is off the table.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  const option = await getOptionWithValues(id)
  if (!option) return NextResponse.json({ error: 'Option not found' }, { status: 404 })
  if (!option.sourceProvider || !option.sourceRef) {
    return NextResponse.json({ error: 'This option was not built from a source.' }, { status: 400 })
  }

  const user = await getSessionFromCookie()
  const provider = await resolveOptionSourceProvider(option.sourceProvider, user)
  if (!provider) return NextResponse.json({ error: 'That source is not available any more.' }, { status: 409 })

  let result
  try {
    result = await refreshOptionFromSource(id, provider)
  } catch (error) {
    if (error instanceof OptionSourceGoneError) {
      return NextResponse.json({ error: 'That source no longer exists.' }, { status: 409 })
    }
    throw error
  }

  if (result.added > 0 || result.updated > 0) {
    // File any image swatches that came across into the product's colours folder,
    // then re-compose the variant child names, which are built from value labels
    // and so go stale the moment a refresh renames one.
    const after = await getOptionWithValues(id)
    for (const value of after?.values ?? []) {
      if (value.swatch) await fileSwatchImage(option.productId, value.id, value.swatch)
    }
    await syncVariantChildNames(option.productId)
  }

  return NextResponse.json(result)
}
