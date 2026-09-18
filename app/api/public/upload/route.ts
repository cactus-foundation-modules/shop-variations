import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'crypto'
import { getActiveMediaProvider, isMediaProviderConfigured } from '@/lib/config/env'
import { uploadMedia, validateUpload } from '@/lib/media/upload'
import { checkInMemoryRateLimit } from '@/modules/shop/lib/rate-limit'
import { getClientIp } from '@/lib/auth/rate-limit'
import { getAddonById } from '@/modules/shop-variations/lib/db/addons'
import { getSettings } from '@/modules/shop-variations/lib/db/settings'
import { createUpload } from '@/modules/shop-variations/lib/db/uploads'

// Public, anonymous-safe personalisation upload. Runs BEFORE add-to-cart and
// returns a token stored in the cart line; the resolver later re-reads the
// stored record (server-authoritative). Rate-limited, size/type validated
// against the add-on config and module settings, stored via a core media
// provider. Never trusts the client content type alone - the extension must
// also be in the allow-list.
const EXT_BY_MIME: Record<string, string[]> = {
  'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/webp': ['webp'], 'image/gif': ['gif'],
  'image/svg+xml': ['svg'], 'application/pdf': ['pdf'],
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])

// The declared type and extension are both the uploader's say-so. Anyone can
// post here, so the bytes are checked too, the same way the media library
// checks its own uploads: images are decoded (a PNG has to actually be a PNG)
// and SVGs are stripped of script before they are stored - an SVG opened
// directly from the bucket runs whatever script it carries. A PDF must at
// least start like one. Other types are only here because the owner listed
// them for this field; there is no universal check for those.
async function checkContent(buffer: Buffer, mimeType: string): Promise<{ ok: true; buffer: Buffer } | { ok: false; reason: string }> {
  if (IMAGE_TYPES.has(mimeType)) {
    // Size is this field's own policy (maxFileMb), already enforced by the
    // caller - only the content check is wanted here, not the library's cap.
    const result = await validateUpload(mimeType, 0, buffer)
    return result.valid ? { ok: true, buffer: result.buffer } : { ok: false, reason: 'That file could not be read as the type it claims to be.' }
  }
  if (mimeType === 'application/pdf' && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { ok: false, reason: 'That file could not be read as a PDF.' }
  }
  return { ok: true, buffer }
}

export async function POST(request: NextRequest) {
  const ip = await getClientIp()
  if (!checkInMemoryRateLimit(`svr-upload:${ip}`, 20, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many uploads, please try again shortly.' }, { status: 429 })
  }

  const provider = await getActiveMediaProvider()
  if (!provider || !isMediaProviderConfigured(provider)) {
    return NextResponse.json({ error: 'File uploads are not available right now.' }, { status: 503 })
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const addonId = form?.get('addonId')
  if (!(file instanceof File) || typeof addonId !== 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const addon = await getAddonById(addonId)
  if (!addon || addon.type !== 'FILE') return NextResponse.json({ error: 'Unknown upload field' }, { status: 400 })

  const settings = await getSettings()
  const maxMb = addon.config.maxFileMb ?? settings.maxUploadMb
  const allowed = (addon.config.allowedTypes || settings.allowedUploadTypes).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

  const declaredType = (file.type || '').toLowerCase()
  if (allowed.length > 0 && !allowed.includes(declaredType)) {
    return NextResponse.json({ error: 'That file type is not allowed.' }, { status: 400 })
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const expectedExts = EXT_BY_MIME[declaredType]
  if (expectedExts && !expectedExts.includes(ext)) {
    return NextResponse.json({ error: 'The file extension does not match its type.' }, { status: 400 })
  }
  if (file.size > maxMb * 1024 * 1024) {
    return NextResponse.json({ error: `File is too large (max ${maxMb} MB).` }, { status: 400 })
  }

  const raw = Buffer.from(await file.arrayBuffer())
  const checked = await checkContent(raw, declaredType)
  if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 })
  const result = await uploadMedia(checked.buffer, declaredType || 'application/octet-stream', provider, file.name, 'shop/personalisation')

  const token = randomUUID()
  await createUpload({
    token,
    mediaRef: result.url,
    mediaProvider: provider,
    mediaKey: result.key,
    filename: file.name,
    size: result.sizeBytes,
    mimeType: result.mimeType,
    ipHash: createHash('sha256').update(ip).digest('hex').slice(0, 32),
  })

  return NextResponse.json({ token, filename: file.name, url: result.url })
}
