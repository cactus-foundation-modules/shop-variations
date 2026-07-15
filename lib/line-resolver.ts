// The shop.cart-line-resolver provider. Shop calls this for every cart line at
// checkout with (product, rawMeta); we validate and price the personalisation
// server-side (the client's prices and file details are never trusted) and hand
// back the normalised meta shop snapshots onto the order line.
//
// Server-safe: runs inside shop's lib/checkout.ts. Precedent for a server-function
// extension point: contact-form.thread-messages -> getCaughtReplyThreadMessages.
import { getVariantByChildProductId } from '@/modules/shop-variations/lib/db/variants'
import { getAddons } from '@/modules/shop-variations/lib/db/addons'
import { getUploadByToken } from '@/modules/shop-variations/lib/db/uploads'
import { computeAddonPricing, type AddonValue } from '@/modules/shop-variations/lib/addon-pricing'
import type { CartLineResolution } from '@/modules/shop/lib/line-meta'
import type { ShpProduct } from '@/modules/shop/lib/types'

const NOOP: CartLineResolution = { valid: true, priceAdjust: 0, persistMeta: null }

export async function resolveVariationLineMeta(product: ShpProduct, meta: Record<string, unknown> | undefined): Promise<CartLineResolution> {
  // Add-ons live on the parent product. If this line is a variant child, look up
  // its parent; otherwise the product owns its own add-ons directly.
  let ownerId = product.id
  if (product.catalogueHidden) {
    const variant = await getVariantByChildProductId(product.id)
    if (variant) ownerId = variant.productId
  }

  const addons = await getAddons(ownerId)
  if (addons.length === 0) return NOOP

  const rawAddons = (meta && typeof meta.addons === 'object' && meta.addons) ? (meta.addons as Record<string, unknown>) : {}

  // Re-resolve file values from the upload record (server-authoritative url and
  // filename); everything else is passed through to the shared pricing function.
  const values: Record<string, AddonValue> = {}
  for (const addon of addons) {
    const raw = rawAddons[addon.id]
    if (addon.type === 'FILE') {
      const token = raw && typeof raw === 'object' ? (raw as { token?: string }).token : undefined
      if (token) {
        const upload = await getUploadByToken(token)
        if (upload) values[addon.id] = { token, filename: upload.filename ?? 'upload', url: upload.mediaRef }
      }
    } else if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      values[addon.id] = raw
    }
  }

  const pricing = computeAddonPricing(addons, values)
  return {
    valid: pricing.valid,
    priceAdjust: pricing.priceAdjust,
    persistMeta: pricing.fields.length ? { fields: pricing.fields } : null,
    reason: pricing.reason,
  }
}
