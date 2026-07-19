import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { resequenceVariantPositions, syncVariantChildNames } from '@/modules/shop-variations/lib/variants-service'

// Put a parent's existing variants back into matrix order after its options or
// their values have been dragged around, and re-compose the child names that
// order feeds.
//
// One call for a whole drag rather than a resequence hung off each option /
// option-value PATCH: the editor writes every moved row concurrently, so a
// per-PATCH resequence would run N times over for one drag and, worse, race -
// each one re-reads the option order to recompute slots, so a slow early call
// could land its answer after a later one and leave the variants describing an
// order that no longer exists.
//
// A renumber, never a regenerate: variants carry stock, prices, photographs and
// any order placed against them, so ids are preserved throughout.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params
  await resequenceVariantPositions(id)
  // Only an *option* reorder actually moves a name (a child is named from its
  // value labels joined in option order, so shuffling values inside one option
  // cannot change it), but the sync only writes rows whose name really differs,
  // so letting both drags through costs a comparison and keeps the caller from
  // having to know the difference.
  const renamed = await syncVariantChildNames(id)
  return NextResponse.json({ ok: true, renamed })
}
