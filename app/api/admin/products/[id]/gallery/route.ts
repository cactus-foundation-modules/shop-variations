import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { getVariants, getVariantValueMap, setVariantGalleryPositions, setVariantShowImageInGallery } from '@/modules/shop-variations/lib/db/variants'

// The variations promoted onto this product's gallery with "Image up front", as
// the product editor's Images tab needs them: one picture each, the slot the
// owner dragged it to, and the description sitting on that picture. They are
// drawn among the product's own photographs in the same grid, so this is a read
// of the same gallery from the other end - see lib/gallery-order.ts.
//
// The description is the picture's own alt text on the variation's hidden child
// product, not a copy kept here. Type one on the Images tab and it is the same
// words the variation's photograph carries everywhere else it appears.

type Promoted = {
  variantId: string
  /** The combination in words, e.g. "Oak / 1600mm", for the tile's caption. */
  label: string
  url: string
  altText: string
  /** Its index in the finished gallery, null for "after the product's own". */
  position: number | null
}

async function loadPromoted(productId: string): Promise<Promoted[]> {
  const variants = (await getVariants(productId)).filter((v) => v.showImageInGallery)
  if (variants.length === 0) return []

  const [options, valueMap] = await Promise.all([
    getOptionsWithValues(productId),
    getVariantValueMap(productId),
  ])
  const labelByValueId = new Map<string, string>()
  const valueOptionOrder = new Map<string, number>()
  options.forEach((o, oi) => o.values.forEach((v) => { labelByValueId.set(v.id, v.label); valueOptionOrder.set(v.id, oi) }))

  // One query for the whole set, primary first within each child - the same
  // ordering everything else calls "its first picture", so the tile on the
  // Images tab is the picture the shopper will actually see.
  const rows = await prisma.$queryRaw<{ product_id: string; url: string; alt_text: string | null }[]>`
    SELECT "product_id", "url", "alt_text"
    FROM "shp_product_media"
    WHERE "product_id" IN (${Prisma.join(variants.map((v) => v.childProductId))}) AND "type" = 'IMAGE'
    ORDER BY "product_id", "is_primary" DESC, "position" ASC
  `
  const firstByChild = new Map<string, { url: string; altText: string }>()
  for (const r of rows) {
    if (firstByChild.has(r.product_id)) continue
    firstByChild.set(r.product_id, { url: r.url, altText: r.alt_text ?? '' })
  }

  // A variation promoted without a photograph of its own contributes no tile -
  // it may have been promoted for its 3D model, which is a separate switch.
  return variants.flatMap((v) => {
    const image = firstByChild.get(v.childProductId)
    if (!image) return []
    const ids = (valueMap[v.id] ?? []).slice().sort((a, b) => (valueOptionOrder.get(a) ?? 0) - (valueOptionOrder.get(b) ?? 0))
    return [{
      variantId: v.id,
      label: ids.map((id) => labelByValueId.get(id)).filter(Boolean).join(' / '),
      url: image.url,
      altText: image.altText,
      position: v.galleryPosition,
    }]
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const { id } = await params
  return NextResponse.json({ images: await loadPromoted(id) })
}

const Body = z.object({
  // The whole arrangement as it now stands: every promoted variation still on the
  // gallery, with its index in the finished list. Sent complete rather than as a
  // diff, because dragging one tile moves every tile after it.
  images: z.array(z.object({
    variantId: z.string().min(1),
    position: z.number().int().min(0).nullable(),
    altText: z.string().max(500),
  })).default([]),
  // Variations taken off the gallery. The picture stays on the variation - this
  // is the "Image up front" tick going off, nothing more.
  demoted: z.array(z.string().min(1)).default([]),
})

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  // Everything is checked against what this product actually owns before it is
  // written: an id from another product's matrix would otherwise reach through
  // this endpoint and rearrange a gallery it has no business in.
  const own = new Map((await getVariants(id)).map((v) => [v.id, v]))
  const demoted = parsed.data.demoted.filter((variantId) => own.has(variantId))
  const images = parsed.data.images.filter((i) => own.has(i.variantId) && !demoted.includes(i.variantId))

  for (const variantId of demoted) {
    await setVariantShowImageInGallery(variantId, false)
  }
  // A demoted variation's slot goes with it, so promoting it again puts it back
  // at the end rather than somewhere it was two months ago.
  await setVariantGalleryPositions([
    ...images.map((i) => ({ id: i.variantId, galleryPosition: i.position })),
    ...demoted.map((variantId) => ({ id: variantId, galleryPosition: null })),
  ])

  // The description belongs to the picture, so it is written where the picture
  // lives: the variation's own first image on its hidden child product. Only the
  // ones that actually changed are touched.
  const childIds = images.map((i) => own.get(i.variantId)!.childProductId)
  if (childIds.length > 0) {
    const rows = await prisma.$queryRaw<{ id: string; product_id: string; alt_text: string | null }[]>`
      SELECT "id", "product_id", "alt_text"
      FROM "shp_product_media"
      WHERE "product_id" IN (${Prisma.join(childIds)}) AND "type" = 'IMAGE'
      ORDER BY "product_id", "is_primary" DESC, "position" ASC
    `
    const firstByChild = new Map<string, { id: string; altText: string }>()
    for (const r of rows) {
      if (firstByChild.has(r.product_id)) continue
      firstByChild.set(r.product_id, { id: r.id, altText: r.alt_text ?? '' })
    }
    for (const image of images) {
      const media = firstByChild.get(own.get(image.variantId)!.childProductId)
      if (!media || media.altText === image.altText) continue
      // Emptied means emptied: an image with no description stores none rather
      // than an empty string, which is the shape the rest of the shop reads.
      const altText = image.altText.trim() === '' ? null : image.altText
      await prisma.$executeRaw`UPDATE "shp_product_media" SET "alt_text" = ${altText} WHERE "id" = ${media.id}`
    }
  }

  return NextResponse.json({ ok: true, images: await loadPromoted(id) })
}
