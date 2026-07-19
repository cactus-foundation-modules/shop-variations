import { prisma } from '@/lib/db/prisma'
import { getOrCreateFolderByPath, resolveFolderPath, moveOrRenameMedia } from '@/lib/media/organise'
import { getProductMediaFolderId } from '@/modules/shop/lib/media/product-media'
import { updateOptionValue } from '@/modules/shop-variations/lib/db/options'

/**
 * The library folder an image-swatch's pictures belong in: shop / <master
 * category> / <product> / colours - the product's own image folder, with a
 * `colours` subfolder so the swatch pictures sit beside the product they dress
 * rather than loose in the library root.
 *
 * Same arrangement, and the same reasoning, as product-3d-views-for-shop's `3d`
 * and product-downloads-for-shop's `downloads` subfolders: the parent folder is
 * resolved through shop, then its (lower-case) path is walked one level deeper.
 *
 * Returns null when the product has no folder of its own yet, which simply means
 * the picture stays where it was - a file in the wrong folder is a tidiness
 * problem, and failing the save over it would be a worse one.
 */
export async function resolveColoursFolderId(productId: string): Promise<string | null> {
  const productFolderId = await getProductMediaFolderId(productId)
  if (productFolderId === null) return null
  const path = await resolveFolderPath(productFolderId)
  if (!path) return null
  return getOrCreateFolderByPath([...path.split('/'), 'colours'])
}

/**
 * File the picture behind an image-swatch value in the product's colours folder,
 * keeping the stored swatch url pointing at it after the move.
 *
 * A no-op unless the swatch is a managed core Media row: a hex colour swatch or
 * an externally-hosted url has nothing in the library to move, so the Media
 * lookup comes first and the colours folder is never created for a product that
 * only uses colour swatches. Moving may rewrite the url (the library keys blobs
 * by folder), so the value's `swatch` column is updated to the new url - the
 * same care reorganiseProductMedia takes for a product's own images.
 */
export async function fileSwatchImage(productId: string, valueId: string, swatchUrl: string): Promise<void> {
  // A sourced value's picture belongs to the module that supplied it - for an
  // attribute-backed option that is the shop-wide attributes folder, where the
  // same "Oak" picture serves every product carrying it. Dragging it into this
  // product's colours folder would move the shared original (the library keys
  // blobs by folder, so the move rewrites the url), leaving the attribute and
  // every other product's copy pointing at a url that no longer serves.
  const value = await prisma.$queryRaw<{ source_ref: string | null }[]>`
    SELECT "source_ref" FROM "svr_option_values" WHERE "id" = ${valueId} LIMIT 1
  `
  if (value[0]?.source_ref) return

  const media = await prisma.media.findFirst({ where: { url: swatchUrl }, select: { id: true } })
  if (!media) return

  const folderId = await resolveColoursFolderId(productId)
  if (folderId === null) return

  try {
    // 'suffix' rather than 'replace': two values pointing at pictures that happen
    // to share a name must not clobber each other in the folder.
    const updated = await moveOrRenameMedia(media.id, { targetFolderId: folderId, collision: 'suffix' })
    if (updated && updated.url !== swatchUrl) {
      await updateOptionValue(valueId, { swatch: updated.url })
    }
  } catch (err) {
    // A picture failing to file (provider hiccup, missing blob) must not fail the
    // save - the value keeps its current url and can be re-filed next time.
    console.warn(`[shop-variations] could not file swatch image ${swatchUrl} for product ${productId}:`, err)
  }
}
