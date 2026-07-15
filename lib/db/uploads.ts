import { prisma } from '@/lib/db/prisma'
import type { SvrUpload } from '@/modules/shop-variations/lib/types'

function mapUpload(r: Record<string, unknown>): SvrUpload {
  return {
    id: r.id as string,
    token: r.token as string,
    mediaRef: r.media_ref as string,
    mediaProvider: (r.media_provider as string | null) ?? null,
    mediaKey: (r.media_key as string | null) ?? null,
    filename: (r.filename as string | null) ?? null,
    size: r.size as number,
    mimeType: r.mime_type as string,
    orderItemId: (r.order_item_id as string | null) ?? null,
    ipHash: (r.ip_hash as string | null) ?? null,
    createdAt: r.created_at as Date,
  }
}

export async function createUpload(data: { token: string; mediaRef: string; mediaProvider: string | null; mediaKey: string | null; filename: string | null; size: number; mimeType: string; ipHash: string | null }): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "svr_uploads" ("token", "media_ref", "media_provider", "media_key", "filename", "size", "mime_type", "ip_hash")
    VALUES (${data.token}, ${data.mediaRef}, ${data.mediaProvider}, ${data.mediaKey}, ${data.filename}, ${data.size}, ${data.mimeType}, ${data.ipHash})
  `
}

// The authoritative record for a personalisation upload - the resolver trusts
// this (server-stored url/filename), never the client-supplied hint.
export async function getUploadByToken(token: string): Promise<SvrUpload | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "svr_uploads" WHERE "token" = ${token} LIMIT 1`
  return rows[0] ? mapUpload(rows[0]) : null
}

// Orphan cleanup: uploads older than the retention window whose stored url never
// made it into any order line's saved personalisation. Cross-checking the url
// against shp_order_items.line_meta means no order-creation hook is needed to
// mark uploads as "used".
export async function deleteOrphanedUploads(retentionDays: number): Promise<number> {
  const result = await prisma.$executeRaw`
    DELETE FROM "svr_uploads" u
    WHERE u."created_at" < NOW() - (${retentionDays} || ' days')::interval
      AND NOT EXISTS (
        SELECT 1 FROM "shp_order_items" oi WHERE oi."line_meta" IS NOT NULL AND oi."line_meta"::text LIKE '%' || u."media_ref" || '%'
      )
  `
  return Number(result)
}

// Media refs (urls) that are orphaned and about to be pruned - so the caller can
// also delete the underlying media blobs.
export async function listOrphanedUploadRefs(retentionDays: number): Promise<SvrUpload[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "svr_uploads" u
    WHERE u."created_at" < NOW() - (${retentionDays} || ' days')::interval
      AND NOT EXISTS (
        SELECT 1 FROM "shp_order_items" oi WHERE oi."line_meta" IS NOT NULL AND oi."line_meta"::text LIKE '%' || u."media_ref" || '%'
      )
  `
  return rows.map(mapUpload)
}
