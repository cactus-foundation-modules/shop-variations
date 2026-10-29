import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import {
  getVariants,
  getVariantValueMap,
  setVariantGalleryArrangements,
  setVariantGalleryImageUrls,
  setVariantGalleryPositions,
  setVariantShowImageInGallery,
  type VariantGalleryArrangement,
} from '@/modules/shop-variations/lib/db/variants'
import { promotedPhotosAsPositionedItems, type GalleryPromotedPhotos } from '@/modules/shop-variations/lib/gallery-order'
import { photoPositionsFor, upFrontImageIndexes } from '@/modules/shop-variations/lib/up-front-images'
import type { SvrVariant } from '@/modules/shop-variations/lib/types'

// The photos promoted onto this product's gallery with "Image up front", as the
// product editor's Images tab needs them: one tile per photo, the slot it sits
// in, and the description on that picture. They are drawn among the product's
// own photographs in the same grid, so this is a read of the same gallery from
// the other end - see lib/gallery-order.ts.
//
// One tile per PHOTO rather than per variation, so a range with two shots of
// each finish can open on one of each and keep the second angles for later
// (migration 020). A variation nobody has arranged that way still comes back as
// its photos one after another at its block's slot, which is where the
// storefront draws them, and the first save from the tab stores a slot for each.
//
// The description is the picture's own alt text on the variation's hidden child
// product, not a copy kept here. Type one on the Images tab and it is the same
// words the variation's photograph carries everywhere else it appears.

type MediaRow = { id: string; product_id: string; url: string; alt_text: string | null }

// Every image on the given variations' hidden child products, primary first -
// the same ordering everything else calls "its first picture".
async function childImages(variants: SvrVariant[]): Promise<Map<string, MediaRow[]>> {
  const byChild = new Map<string, MediaRow[]>()
  if (variants.length === 0) return byChild
  const rows = await prisma.$queryRaw<MediaRow[]>`
    SELECT "id", "product_id", "url", "alt_text"
    FROM "shp_product_media"
    WHERE "product_id" IN (${Prisma.join(variants.map((v) => v.childProductId))}) AND "type" = 'IMAGE'
    ORDER BY "product_id", "is_primary" DESC, "position" ASC
  `
  for (const r of rows) byChild.set(r.product_id, [...(byChild.get(r.product_id) ?? []), r])
  return byChild
}

// The photos a promoted variation puts up front, in its own order.
function upFrontPhotos(variant: SvrVariant, images: Map<string, MediaRow[]>): MediaRow[] {
  const own = images.get(variant.childProductId) ?? []
  return upFrontImageIndexes(own.map((r) => r.url), variant.galleryImageUrls).map((i) => own[i]!)
}

type Promoted = {
  variantId: string
  /** The combination in words, e.g. "Oak / 1600mm", for the tile's caption. */
  label: string
  url: string
  altText: string
  /** Its index in the finished gallery, counted in pictures; null for "after the rest". */
  position: number | null
  /** Which of the variation's up-front photos this is (1-based), and how many there are. */
  photoNumber: number
  photoCount: number
}

async function loadPromoted(productId: string): Promise<Promoted[]> {
  const variants = (await getVariants(productId)).filter((v) => v.showImageInGallery)
  if (variants.length === 0) return []

  const [options, valueMap, images] = await Promise.all([
    getOptionsWithValues(productId),
    getVariantValueMap(productId),
    childImages(variants),
  ])
  const labelByValueId = new Map<string, string>()
  const valueOptionOrder = new Map<string, number>()
  options.forEach((o, oi) => o.values.forEach((v) => { labelByValueId.set(v.id, v.label); valueOptionOrder.set(v.id, oi) }))
  const labelOf = (variantId: string) => (valueMap[variantId] ?? [])
    .slice()
    .sort((a, b) => (valueOptionOrder.get(a) ?? 0) - (valueOptionOrder.get(b) ?? 0))
    .map((id) => labelByValueId.get(id))
    .filter(Boolean)
    .join(' / ')

  // Slots worked out by the same function the storefront uses, so a variation
  // still stored as one block shows on the tab exactly where the shopper sees it.
  // A variation promoted without a photograph of its own contributes no tile -
  // it may have been promoted for its 3D model, which is a separate switch.
  const entries: Array<GalleryPromotedPhotos<Omit<Promoted, 'position'>>> = variants.flatMap((v) => {
    const photos = upFrontPhotos(v, images)
    if (photos.length === 0) return []
    const label = labelOf(v.id)
    return [{
      galleryPosition: v.galleryPosition,
      item: photos.map((photo, i) => ({
        variantId: v.id,
        label,
        url: photo.url,
        altText: photo.alt_text ?? '',
        photoNumber: i + 1,
        photoCount: photos.length,
      })),
      photoPositions: photoPositionsFor(photos.map((p) => p.url), v.galleryImageUrls, v.galleryImagePositions),
    }]
  })
  return promotedPhotosAsPositionedItems(entries).map(({ galleryPosition, item }) => ({ ...item, position: galleryPosition }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products', { allowAccess: true })
  if (gate.error) return gate.error
  const { id } = await params
  return NextResponse.json({ images: await loadPromoted(id) })
}

const Body = z.object({
  // The whole arrangement as it now stands: every promoted photo still on the
  // gallery, with its index in the finished list. Sent complete rather than as a
  // diff, because dragging one tile moves every tile after it. `url` is absent
  // from an Images tab loaded before tiles were per photo, whose `position` is
  // the variation's block slot.
  images: z.array(z.object({
    variantId: z.string().min(1),
    url: z.string().min(1).optional(),
    position: z.number().int().min(0).nullable(),
    altText: z.string().max(500),
  })).default([]),
  // Photos taken off the gallery. Each stays on its variation; the last one off
  // turns the variation's "Image up front" off.
  removed: z.array(z.object({ variantId: z.string().min(1), url: z.string().min(1) })).default([]),
  // Whole variations taken off, from a tab loaded before tiles were per photo.
  demoted: z.array(z.string().min(1)).default([]),
})

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const body = parsed.data

  // Everything is checked against what this product actually owns before it is
  // written: an id from another product's matrix would otherwise reach through
  // this endpoint and rearrange a gallery it has no business in. Only promoted
  // variations are arranged here - promoting one is the Variations tab's job.
  const promoted = (await getVariants(id)).filter((v) => v.showImageInGallery)
  const images = await childImages(promoted)

  const demoted: string[] = []
  const blockSlots: Array<{ id: string; galleryPosition: number | null }> = []
  const arrangements: VariantGalleryArrangement[] = []
  const trimmed: Array<{ id: string; urls: string[] }> = []
  // The pictures whose description may have changed: [media row, wanted text].
  const described: Array<[MediaRow, string]> = []

  for (const v of promoted) {
    const photos = upFrontPhotos(v, images)
    const gone = new Set(body.removed.filter((r) => r.variantId === v.id).map((r) => r.url))
    const kept = photos.filter((p) => !gone.has(p.url))
    if (body.demoted.includes(v.id) || (photos.length > 0 && kept.length === 0)) {
      demoted.push(v.id)
      continue
    }

    const perPhoto = body.images.filter((i) => i.variantId === v.id && i.url !== undefined)
    const block = body.images.find((i) => i.variantId === v.id && i.url === undefined)
    if (perPhoto.length > 0) {
      const slot = new Map(perPhoto.flatMap((i) => (i.url === undefined ? [] : [[i.url, i.position] as const])))
      arrangements.push({ id: v.id, imageUrls: kept.map((p) => p.url), imagePositions: kept.map((p) => slot.get(p.url) ?? null) })
      for (const photo of kept) {
        const wanted = perPhoto.find((i) => i.url === photo.url)
        if (wanted) described.push([photo, wanted.altText])
      }
    } else if (block) {
      blockSlots.push({ id: v.id, galleryPosition: block.position })
      if (photos[0]) described.push([photos[0], block.altText])
    } else if (gone.size > 0) {
      trimmed.push({ id: v.id, urls: kept.map((p) => p.url) })
    }
  }

  for (const variantId of demoted) {
    await setVariantShowImageInGallery(variantId, false)
  }
  // A demoted variation's slots go with it, so promoting it again puts it back
  // at the end rather than somewhere it was two months ago.
  await setVariantGalleryPositions([...blockSlots, ...demoted.map((variantId) => ({ id: variantId, galleryPosition: null }))])
  await setVariantGalleryArrangements(arrangements)
  for (const t of trimmed) await setVariantGalleryImageUrls(t.id, t.urls)

  // The description belongs to the picture, so it is written where the picture
  // lives: on the variation's hidden child product. Only the ones that actually
  // changed are touched. Emptied means emptied: an image with no description
  // stores none rather than an empty string, which is the shape the rest of the
  // shop reads.
  for (const [media, text] of described) {
    if ((media.alt_text ?? '') === text) continue
    const altText = text.trim() === '' ? null : text
    await prisma.$executeRaw`UPDATE "shp_product_media" SET "alt_text" = ${altText} WHERE "id" = ${media.id}`
  }

  return NextResponse.json({ ok: true, images: await loadPromoted(id) })
}
