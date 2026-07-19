import { prisma } from '@/lib/db/prisma'

// Provider for the core.media-usage-providers extension point.
//
// An option value's swatch column holds either a colour (a hex string, which
// matches nothing in the library and is harmless to return) or the url of a
// swatch image picked from the media library. Customer personalisation uploads in
// svr_uploads keep a url and a storage key. None of it is reachable from core, so
// without this every image swatch on the site counted as unused.
export async function shopVariationsMediaUsageProvider(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ ref: string | null }[]>`
    SELECT "swatch" AS ref FROM "svr_option_values" WHERE "swatch" IS NOT NULL
    UNION ALL
    SELECT "media_ref" AS ref FROM "svr_uploads" WHERE "media_ref" IS NOT NULL
    UNION ALL
    SELECT "media_key" AS ref FROM "svr_uploads" WHERE "media_key" IS NOT NULL
  `
  return rows.map((r) => r.ref).filter((r): r is string => !!r)
}
