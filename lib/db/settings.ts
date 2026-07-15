import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { SvrSettings } from '@/modules/shop-variations/lib/types'

const DEFAULTS: SvrSettings = {
  maxUploadMb: 10,
  allowedUploadTypes: 'image/png,image/jpeg,image/webp,application/pdf',
  uploadRetentionDays: 30,
  maxVariants: 200,
}

function mapSettings(r: Record<string, unknown>): SvrSettings {
  return {
    maxUploadMb: r.max_upload_mb as number,
    allowedUploadTypes: r.allowed_upload_types as string,
    uploadRetentionDays: r.upload_retention_days as number,
    maxVariants: r.max_variants as number,
  }
}

export async function getSettings(): Promise<SvrSettings> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "svr_settings" WHERE "id" = 'singleton' LIMIT 1`
  return rows[0] ? mapSettings(rows[0]) : DEFAULTS
}

export async function updateSettings(fields: Partial<SvrSettings>): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (fields.maxUploadMb !== undefined) sets.push(Prisma.sql`"max_upload_mb" = ${fields.maxUploadMb}`)
  if (fields.allowedUploadTypes !== undefined) sets.push(Prisma.sql`"allowed_upload_types" = ${fields.allowedUploadTypes}`)
  if (fields.uploadRetentionDays !== undefined) sets.push(Prisma.sql`"upload_retention_days" = ${fields.uploadRetentionDays}`)
  if (fields.maxVariants !== undefined) sets.push(Prisma.sql`"max_variants" = ${fields.maxVariants}`)
  if (sets.length === 0) return
  sets.push(Prisma.sql`"updated_at" = CURRENT_TIMESTAMP`)
  await prisma.$executeRaw`
    INSERT INTO "svr_settings" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING
  `
  await prisma.$executeRaw`UPDATE "svr_settings" SET ${Prisma.join(sets, ', ')} WHERE "id" = 'singleton'`
}
