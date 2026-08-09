'use client'

// The purchase-companion seam: how another module's page component rides along
// on this module's add-to-basket.
//
// Same no-import bargain as selection-broadcast.ts, in the other direction: a
// companion module (a product-accessories box under the Add to basket button,
// say) must not be imported from here - it may not be installed - and it cannot
// import us. So the seam is a window-level registry with a documented shape:
// the companion registers a provider while its component is mounted, and add()
// consults every registered provider at the moment the shopper adds.
//
// A provider is SLUG-KEYED and must deregister on unmount: a stale provider
// left behind by a previous product page must never inject its lines into an
// unrelated add. Providers whose slug does not match the page being added from
// are skipped for the same reason.
//
// What a provider returns:
//   mainMeta  - merged into the main line's meta (this is what lets a companion
//               stamp the main line with a group so its own lines can point at
//               it). Keys are the provider's to namespace.
//   lines     - extra cart lines added alongside, each with its own meta. Added
//               AFTER the main line so the main line's unshift leaves the set
//               adjacent; display order is the group's business, not storage's.
//
// Returning null (or an empty lines array with no mainMeta) means "nothing to
// add" - the ordinary add proceeds untouched.

export type CompanionLineRequest = {
  productId: string
  quantity: number
  lineId?: string
  meta?: Record<string, unknown>
}

export type CompanionContribution = {
  mainMeta?: Record<string, unknown>
  lines: CompanionLineRequest[]
} | null

export type PurchaseCompanionContext = {
  // The product page's slug - the same one the variation islands key by.
  slug: string
  // The listing (parent) product and the exact variation being added.
  parentProductId: string
  productId: string
  quantity: number
}

export type PurchaseCompanionProvider = {
  // The page this provider belongs to; contributions are ignored elsewhere.
  slug: string
  collect: (ctx: PurchaseCompanionContext) => CompanionContribution
}

declare global {
  interface Window {
    __cactusPurchaseCompanions?: Map<string, PurchaseCompanionProvider>
  }
}

function registry(): Map<string, PurchaseCompanionProvider> {
  if (!window.__cactusPurchaseCompanions) window.__cactusPurchaseCompanions = new Map()
  return window.__cactusPurchaseCompanions
}

/** Register under a stable id; returns the deregistration for unmount. */
export function registerPurchaseCompanion(id: string, provider: PurchaseCompanionProvider): () => void {
  if (typeof window === 'undefined') return () => {}
  registry().set(id, provider)
  return () => {
    const map = window.__cactusPurchaseCompanions
    if (map?.get(id) === provider) map.delete(id)
  }
}

/**
 * Every registered provider's contribution for one add, slug-checked. Called by
 * use-variation-selection's add(); exported for it alone, but harmless anywhere.
 * A provider that throws is skipped - a broken companion must not stop the
 * shopper buying the main product.
 */
export function collectPurchaseCompanions(ctx: PurchaseCompanionContext): {
  mainMeta: Record<string, unknown>
  lines: CompanionLineRequest[]
} {
  const out: { mainMeta: Record<string, unknown>; lines: CompanionLineRequest[] } = { mainMeta: {}, lines: [] }
  if (typeof window === 'undefined') return out
  const map = window.__cactusPurchaseCompanions
  if (!map) return out
  for (const provider of map.values()) {
    if (provider.slug !== ctx.slug) continue
    try {
      const contribution = provider.collect(ctx)
      if (!contribution) continue
      if (contribution.mainMeta) {
        // First writer keeps a key, matching how shop folds resolver meta.
        for (const [key, value] of Object.entries(contribution.mainMeta)) {
          if (!(key in out.mainMeta)) out.mainMeta[key] = value
        }
      }
      for (const line of contribution.lines ?? []) {
        if (line && line.productId && line.quantity > 0) out.lines.push(line)
      }
    } catch {
      // A companion that cannot answer contributes nothing.
    }
  }
  return out
}
