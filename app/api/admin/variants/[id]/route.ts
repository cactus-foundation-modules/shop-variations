import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { updateProduct, setProductMedia, deleteProduct } from '@/modules/shop/lib/db/products'
import { reorganiseProductMedia } from '@/modules/shop/lib/media/product-media'
import { getVariantById, setVariantEnabled } from '@/modules/shop-variations/lib/db/variants'

const Body = z.object({
  price: z.number().nonnegative().optional(),
  sku: z.string().max(120).nullable().optional(),
  barcode: z.string().max(120).nullable().optional(),
  trackInventory: z.boolean().optional(),
  stockCount: z.number().int().nullable().optional(),
  weight: z.number().nonnegative().nullable().optional(),
  enabled: z.boolean().optional(),
  // A single media URL for this variant's image, or null to clear it.
  imageUrl: z.string().url().nullable().optional(),
})

// Per-variant edit. Scalar fields live on the hidden child product and go
// through shop's updateProduct/setProductMedia so inventory stays consistent;
// `enabled` lives on the variant mapping.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  const variant = await getVariantById(id)
  if (!variant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 })

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const data = parsed.data

  const productFields: Parameters<typeof updateProduct>[1] = {}
  if (data.price !== undefined) productFields.price = data.price
  if (data.sku !== undefined) productFields.sku = data.sku
  if (data.barcode !== undefined) productFields.barcode = data.barcode
  if (data.trackInventory !== undefined) productFields.trackInventory = data.trackInventory
  if (data.stockCount !== undefined) productFields.stockCount = data.stockCount
  if (data.weight !== undefined) productFields.weight = data.weight
  if (Object.keys(productFields).length > 0) await updateProduct(variant.childProductId, productFields)

  if (data.imageUrl !== undefined) {
    await setProductMedia(variant.childProductId, data.imageUrl ? [{ type: 'IMAGE', url: data.imageUrl, isPrimary: true }] : [])
    // File the variant's image in the parent product's media-library folder, so
    // every image for a product - its own and its variants' - sits together.
    // The child is a hidden product with no categories of its own, so left to
    // itself it would land under "Uncategorised"; passing the parent as the
    // folder owner keeps the name (from the child's unique slug) but borrows the
    // parent's folder.
    if (data.imageUrl) await reorganiseProductMedia(variant.childProductId, { folderProductId: variant.productId })
  }

  if (data.enabled !== undefined) await setVariantEnabled(id, data.enabled)

  return NextResponse.json({ ok: true })
}

// Delete a single variant. The row a shopper never picks (one of hundreds a big
// matrix throws up) can go on its own, without rebuilding the lot. Deleting the
// hidden child product cascades the svr_variants + svr_variant_values rows away,
// the same path clear-variants takes per row. Gated on shop.products.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  const variant = await getVariantById(id)
  if (!variant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 })

  await deleteProduct(variant.childProductId)

  return NextResponse.json({ ok: true })
}
