'use client'

// Which variation the shopper has settled on, published to the whole page.
//
// The selection store below (use-variation-selection.ts) keys islands by product
// slug, which is enough for THIS module's own parts. Another module's block on
// the same page cannot join in: it must not import from
// '@/modules/shop-variations/...' at all, because that path does not exist on an
// install without this module and a static import would break the build there.
// (The same reasoning as the delivery module's variations bridge, in reverse.)
//
// So the seam is a plain browser one, with no import in either direction: a
// window CustomEvent whose name is a documented string, plus the latest detail
// parked on `window` so a block that mounts late does not have to wait for the
// next change to learn where things stand.
//
//   Event:    'cactus-shop-variant-selection'
//   Detail:   VariantSelectionDetail (below), also at
//             window.__cactusVariantSelection
//
// A consumer reads the snapshot on mount and listens for the event afterwards.
// `productId` is the variation the shopper has actually landed on and is null
// until a full combination is chosen - which is the difference between "price
// this exact chair" and "we do not know which chair yet".

export const VARIANT_SELECTION_EVENT = 'cactus-shop-variant-selection'

export type VariantSelectionDetail = {
  // The product page's own slug, so a consumer can ignore a page it is not on.
  slug: string
  // The listing product (the parent), null before its payload has loaded.
  parentProductId: string | null
  // The resolved variation's own product, or null while the combination is
  // incomplete (or the product has no options at all, where the listing IS the
  // thing being bought).
  productId: string | null
  allOptionsChosen: boolean
  // Every option value picked SO FAR (svr_option_values ids), in the options'
  // own display order. `productId` above only appears once the last option is
  // settled, so a consumer that has to say something sensible about a half-built
  // combination - "this delivery service is available in Black Fabric, Blue or
  // Charcoal", meaning given what you have already chosen - has nothing else to
  // go on. Empty while nothing is picked; a full set once everything is.
  chosenValueIds: string[]
}

declare global {
  interface Window {
    __cactusVariantSelection?: VariantSelectionDetail
  }
}

// Every island running the hook publishes, so the same state arrives many times
// over. Only a real change is announced; the rest are dropped here rather than
// left for each consumer to filter.
let last: string | null = null

export function publishVariantSelection(detail: VariantSelectionDetail): void {
  if (typeof window === 'undefined') return
  const encoded = JSON.stringify(detail)
  if (encoded === last) return
  last = encoded
  window.__cactusVariantSelection = detail
  window.dispatchEvent(new CustomEvent<VariantSelectionDetail>(VARIANT_SELECTION_EVENT, { detail }))
}

export function getVariantSelection(): VariantSelectionDetail | null {
  if (typeof window === 'undefined') return null
  return window.__cactusVariantSelection ?? null
}
