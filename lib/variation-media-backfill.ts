import { prisma } from '@/lib/db/prisma'
import { moveOrRenameMedia } from '@/lib/media/organise'
import { resolveVariationsFolderId } from '@/modules/shop-variations/lib/media-folder'

// Moving an established shop's variant pictures into each product's `variations`
// folder.
//
// They used to be filed in among the parent's own photographs, which is readable
// for a product with two variants and hopeless for one with two hundred: 26,054
// of the 28,335 product pictures on the catalogue this was written for belong to
// a variant. New pictures go to the subfolder (see the variant save route and the
// CSV import); this walks what is already on the shelves.
//
// Written to be run repeatedly rather than to run once perfectly. It works parent
// product by parent product in id order and reports the last one it finished, so
// a run that is cut off resumes from there, and a product already done costs a
// couple of queries and moves nothing.
//
// Each picture's small copies follow it automatically - core carries them when
// the original moves - so this leaves the `variations/thumb` folder behind it
// without being told to. Run it BEFORE core's rendition tidy-up
// (scripts/backfill-rendition-folders.mts), or the tidy-up simply does the same
// work twice.
//
// A terminal job rather than a button: every picture moved is a blob copy and a
// delete at the storage provider. See scripts/backfill-variation-folders.mts.

export type VariationRefileProgress = {
  /** Parent products looked at so far in this run. */
  productsSeen: number
  /** Pictures moved into a `variations` folder. */
  moved: number
  /** Pictures that were already there, or could not be moved. */
  left: number
}

export type VariationRefileResult = VariationRefileProgress & {
  /** The last parent product id this run finished - pass it back as `after` to carry on. */
  lastProductId: string | null
  /** Whether there are products after that one. */
  more: boolean
}

/** How many variant pictures are still filed outside a `variations` folder. */
export async function countVariationImagesToRefile(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n
    FROM "shp_product_media" pm
    JOIN "Media" m ON m."url" = pm."url"
    LEFT JOIN "Folder" f ON f."id" = m."folderId"
    WHERE pm."type" = 'IMAGE'
      AND pm."product_id" IN (SELECT "child_product_id" FROM "svr_variants")
      AND (f."name" IS NULL OR f."name" <> 'variations')
      -- A picture the parent listing also uses is left in the parent's folder on
      -- purpose (see refileVariationImages), so it is not outstanding work.
      AND NOT EXISTS (
        SELECT 1 FROM "shp_product_media" own
        JOIN "svr_variants" v ON v."child_product_id" = pm."product_id"
        WHERE own."product_id" = v."product_id" AND own."type" = 'IMAGE' AND own."url" = pm."url"
      )
  `
  return Number(rows[0]?.n ?? 0)
}

/**
 * Move the variant pictures of up to `limit` parent products into each product's
 * `variations` folder.
 *
 * The folder is resolved once per PARENT rather than once per variant: a range
 * with two hundred variants would otherwise walk the same category trail two
 * hundred times for one answer.
 *
 * Only pictures that resolve to a managed library item are touched - an
 * externally-hosted url has nothing to move. `dryRun` counts and moves nothing.
 */
export async function refileVariationImages(opts?: {
  after?: string | null
  limit?: number
  dryRun?: boolean
  onProgress?: (p: VariationRefileProgress) => void
}): Promise<VariationRefileResult> {
  const limit = opts?.limit ?? 20
  const dryRun = opts?.dryRun ?? false
  const after = opts?.after ?? null

  // One more than asked for, to answer "is there more after this?" without a
  // second count over the whole table.
  const parents = await prisma.$queryRaw<{ productId: string }[]>`
    SELECT DISTINCT "product_id" AS "productId" FROM "svr_variants"
    WHERE (${after}::text IS NULL OR "product_id" > ${after}::text)
    ORDER BY "product_id" ASC
    LIMIT ${limit + 1}
  `
  const more = parents.length > limit
  const batch = parents.slice(0, limit)

  const progress: VariationRefileProgress = { productsSeen: 0, moved: 0, left: 0 }
  let lastProductId: string | null = after
  if (batch.length === 0) return { ...progress, lastProductId, more: false }

  for (const { productId } of batch) {
    progress.productsSeen += 1
    lastProductId = productId

    // Every picture on every variant of this product, with the library item it
    // resolves to. Rows whose url is not a managed item simply do not join and
    // are left exactly as they are.
    // A picture the parent listing ALSO uses is left alone, the same rule the
    // variant save files under. Moving it would set two saves fighting over one
    // blob - this drags it into `variations`, the parent's next save drags it back
    // - and each tug is a real copy and delete at the storage provider.
    const images = await prisma.$queryRaw<{ mediaId: string; folderId: string | null }[]>`
      SELECT DISTINCT m."id" AS "mediaId", m."folderId" AS "folderId"
      FROM "shp_product_media" pm
      JOIN "Media" m ON m."url" = pm."url"
      WHERE pm."type" = 'IMAGE'
        AND pm."product_id" IN (SELECT "child_product_id" FROM "svr_variants" WHERE "product_id" = ${productId})
        AND pm."url" NOT IN (
          SELECT "url" FROM "shp_product_media" WHERE "product_id" = ${productId} AND "type" = 'IMAGE'
        )
    `
    if (images.length === 0) {
      opts?.onProgress?.({ ...progress })
      continue
    }

    if (dryRun) {
      // Approximate on purpose: the destination is not resolved (and so never
      // created) on a dry run, so "somewhere else" is counted rather than
      // "somewhere other than the folder this would make".
      progress.moved += images.length
      opts?.onProgress?.({ ...progress })
      continue
    }

    const folderId = await resolveVariationsFolderId(productId)
    if (folderId === null) {
      // No folder for the parent at all - nothing filed under it yet. The pictures
      // stay where they are and the next product save files them.
      progress.left += images.length
      opts?.onProgress?.({ ...progress })
      continue
    }

    // The same two flags a product save files under: an exact-name key so the url
    // still reads as the uploaded name, and 'suffix' so two pictures that happen
    // to share a name are kept apart rather than one replacing the other.
    for (const image of images) {
      if (image.folderId === folderId) {
        progress.left += 1
        continue
      }
      try {
        await moveOrRenameMedia(image.mediaId, { targetFolderId: folderId, exactName: true, collision: 'suffix' })
        progress.moved += 1
      } catch (err) {
        // One picture failing must not end the sweep: it keeps its current url,
        // which still serves, and the next run tries again.
        console.warn(`[shop-variations] could not refile variant image ${image.mediaId}:`, err)
        progress.left += 1
      }
      opts?.onProgress?.({ ...progress })
    }
  }

  return { ...progress, lastProductId, more }
}
