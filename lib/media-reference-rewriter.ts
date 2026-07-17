import { prisma } from '@/lib/db/prisma'
import type { MediaReferenceChange } from '@/lib/media/reference-rewriters'

// Provider for the core.media-reference-rewriters extension point.
//
// An IMAGE-type option value keeps its swatch picture's public url in
// svr_option_values.swatch (the same column holds a hex colour for SWATCH/PILL
// controls). The admin stores the picker's Media.url in it verbatim. When core
// moves a blob (optimise to WebP, resize, rename, replace), the item's url
// changes but the swatch column still names the old, now-deleted blob, so the
// image swatch 404s. Repoint it onto the new url.
//
// Equality, not substring: the column IS the whole url for an image swatch, so
// `= oldUrl` cannot match a hex colour or an unrelated row.
export async function shopVariationsMediaReferenceRewriter(change: MediaReferenceChange): Promise<void> {
  const { oldUrl, newUrl } = change
  if (!oldUrl || oldUrl === newUrl) return

  await prisma.$executeRaw`
    UPDATE "svr_option_values" SET "swatch" = ${newUrl} WHERE "swatch" = ${oldUrl}
  `
}
