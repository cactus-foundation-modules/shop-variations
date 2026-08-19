// The shop.cart-line-resolver provider. Shop calls this for every cart line at
// checkout with (product, rawMeta); we validate and price the personalisation
// server-side (the client's prices and file details are never trusted) and hand
// back the normalised meta shop snapshots onto the order line.
//
// Server-safe: runs inside shop's lib/checkout.ts. Precedent for a server-function
// extension point: contact-form.thread-messages -> getCaughtReplyThreadMessages.
import { getAddonsForLine, prefetchAddons } from '@/modules/shop-variations/lib/addon-cache'
import { buildVariantTitle, getVariantMinOrder, prefetchVariantTitles } from '@/modules/shop-variations/lib/variant-title-cache'
import { getUploadByToken } from '@/modules/shop-variations/lib/db/uploads'
import { computeAddonPricing, type AddonValue } from '@/modules/shop-variations/lib/addon-pricing'
import type { CartLineResolution } from '@/modules/shop/lib/line-meta'
import type { ShpProduct } from '@/modules/shop/lib/types'

const NOOP: CartLineResolution = { valid: true, priceAdjust: 0, persistMeta: null }

export async function resolveVariationLineMeta(product: ShpProduct, meta: Record<string, unknown> | undefined): Promise<CartLineResolution> {
  // A variant child's cart name ("Parent - Red / L") is split into a base name +
  // chosen options so the cart can show them on separate lines. Computed for
  // every variant line, add-ons or not (a plain variant has no add-on fields but
  // still wants its options lifted off the name line). Null for a non-variant.
  const displayTitle = await buildVariantTitle(product)

  // Which listing this line is a way of buying, and what that listing's minimum
  // order actually is. Shop pools the minimum across the key, so a shopper
  // taking one of each of four colours has met a minimum of four - the minimum
  // belongs to the chair, not to the colour - and it needs the figure from here
  // because a child row hardly ever carries one of its own. Null for anything
  // that is not a variation, which then stands on its own row exactly as an
  // ordinary product does.
  const minOrder = await getVariantMinOrder(product)

  // Add-ons live on the parent product. If this line is a variant child, its
  // owner is the parent; otherwise the product owns its own add-ons directly.
  // getAddonsForLine serves this from the request batch cache when shop
  // prefetched the whole cart, and falls back to the per-line lookups otherwise.
  const addons = await getAddonsForLine(product)
  if (addons.length === 0) return { ...NOOP, displayTitle, minOrder }

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
    displayTitle,
    minOrder,
  }
}

// shop.cart-line-resolver-prefetch: map every cart line to its add-on owner and
// load all owners' add-ons in two batched queries before shop folds the lines,
// so resolveVariationLineMeta above is a cache read per line instead of two
// queries. Called once per cart validate / checkout resolve with the whole set.
export async function prefetchVariationLineMeta(products: ShpProduct[]): Promise<void> {
  await Promise.all([prefetchAddons(products), prefetchVariantTitles(products)])
}
