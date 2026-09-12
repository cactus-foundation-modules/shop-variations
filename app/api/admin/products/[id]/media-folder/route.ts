import { NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { findVariationsFolderId, resolveVariationsFolderId } from '@/modules/shop-variations/lib/media-folder'

/**
 * Where a variant's pictures are filed: shop / <master category> / <product> /
 * variations. The variations grid asks for it immediately before uploading, so
 * the picture is written straight there rather than landing in the parent's own
 * folder and waiting for the save to move it.
 *
 * The same GET/POST split, for the same reason, as shop's own
 * products/[id]/media-folder: the POST creates the folder and is called at the
 * moment of upload, the GET only looks and is called when the picker opens - so
 * a range anyone merely glanced at does not gain an empty folder.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const folderId = await findVariationsFolderId(id)
  return NextResponse.json({ folderId })
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const folderId = await resolveVariationsFolderId(id)
  if (folderId === null) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  return NextResponse.json({ folderId })
}
