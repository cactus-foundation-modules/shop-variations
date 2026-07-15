import { NextRequest, NextResponse } from 'next/server'
import type { MediaProviderType } from '@prisma/client'
import { errorResponse } from '@/lib/utils'
import { deleteMedia } from '@/lib/media/upload'
import { getSettings } from '@/modules/shop-variations/lib/db/settings'
import { listOrphanedUploadRefs, deleteOrphanedUploads } from '@/modules/shop-variations/lib/db/uploads'

// Prunes personalisation uploads that were never attached to an order within the
// retention window (an abandoned upload). Deletes the stored blob first, then the
// tracking row. Same CRON_SECRET bearer as shop's crons.
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return errorResponse('CRON_SECRET is not configured', 503)
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return errorResponse('Unauthorized', 401)

  const settings = await getSettings()
  const orphans = await listOrphanedUploadRefs(settings.uploadRetentionDays)

  for (const upload of orphans) {
    if (upload.mediaProvider && upload.mediaKey) {
      try {
        await deleteMedia(upload.mediaProvider as MediaProviderType, upload.mediaKey)
      } catch {
        // best-effort - the row is removed regardless so it won't be retried forever
      }
    }
  }

  const removed = await deleteOrphanedUploads(settings.uploadRetentionDays)
  return NextResponse.json({ ok: true, removed })
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
