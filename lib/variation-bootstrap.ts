// Server-side resolution of the variation payload, so a product page ships its
// option controls in the first HTML rather than fetching them after hydration.
//
// The storefront islands used to do all of this in the browser: wait for
// hydration, read the slug out of window.location, then GET
// /api/m/shop-variations/public/by-slug/<slug>/variations (and a second GET for
// the shop's currency). On a cold serverless function that is a visible pause on
// the one part of the page the shopper is there to use. Everything those two
// requests return is already knowable while the page is being rendered, so it is
// resolved here and handed down as a plain prop instead.
//
// Server-only: pulls in prisma through variants-service. Never import this from
// a 'use client' file - the RSC halves (*.rsc.tsx) are its only callers, which is
// why they live apart from the editor-safe block files.
import { cache } from 'react'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { currentProductPageSearchParams } from '@/modules/shop/lib/product-page-params'
import { getVariantSelectorPayloadBySlug } from '@/modules/shop-variations/lib/variants-service'
import { selectionValueIdsFromParams } from '@/modules/shop-variations/lib/url-selection'
import type { VariationBootstrap } from '@/modules/shop-variations/lib/types'

// Request-scoped slot holding the product being rendered. `cache` hands back the
// same object for every call within one request and a fresh one for the next, so
// this cannot leak a slug between two shoppers the way a module-level `let`
// would.
//
// Why we need it at all: our granular blocks (ShopVariantOptions and friends) sit
// inside shop's Product Detail template, and Puck's <Render> gives a block only
// its own saved props. Shop injects the product into its own parts and, quite
// rightly, knows nothing about ours - so there is no prop to read the slug from.
// The one place shop does hand us the product server-side is the detail-parts
// provider's `claimsProduct`, which runs once per product page before any block
// renders. It records the slug here on the way past.
const productSlotRef = cache((): { slug: string | null } => ({ slug: null }))

export function rememberProductSlug(slug: string): void {
  productSlotRef().slug = slug
}

export function currentProductSlug(): string | null {
  return productSlotRef().slug
}

// A second request-scoped slot, holding the option-value ids to open the
// selector on when this page was reached through a variant's own deep link (the
// hidden child product's URL). shop's product-page resolver records it as it
// aliases the child slug to its parent (see lib/product-page-resolver.ts), and
// getVariationBootstrap below carries it into the payload the storefront seeds
// from. Request-scoped by the same cache() trick as the slug, so one shopper's
// deep link can never bleed a preselection into another's page. Null on a normal
// product page, which opens unchosen.
const preselectSlotRef = cache((): { optionValueIds: string[] | null } => ({ optionValueIds: null }))

export function rememberPreselectOptionValues(optionValueIds: string[]): void {
  preselectSlotRef().optionValueIds = optionValueIds
}

export function currentPreselectOptionValues(): string[] | null {
  return preselectSlotRef().optionValueIds
}

// One payload per product per request, however many blocks ask for it: the
// composite block alone would otherwise repeat this query five times over.
export const getVariationBootstrap = cache(async (slug: string): Promise<VariationBootstrap | null> => {
  const [payload, config] = await Promise.all([
    getVariantSelectorPayloadBySlug(slug),
    getShopConfigCached(),
  ])
  if (!payload) return null
  // A deep-linked variant's picks, if this request arrived through one - else
  // the picks a shared link's own option parameters name (the address bar the
  // shopper copied; see url-selection.ts). Only ones this payload actually
  // carries are passed on, so a stale or foreign id can never seed a pick the
  // controls have no value for. Absent otherwise.
  let preselect = currentPreselectOptionValues()
  if (!preselect || preselect.length === 0) {
    const searchParams = currentProductPageSearchParams()
    const fromParams = searchParams ? selectionValueIdsFromParams(payload, searchParams) : []
    if (fromParams.length > 0) preselect = fromParams
  }
  const known = preselect ? new Set(payload.options.flatMap((o) => o.values.map((v) => v.id))) : null
  const preselectOptionValueIds = preselect?.filter((id) => known?.has(id))
  return {
    payload,
    currencySymbol: config.currencySymbol,
    ...(preselectOptionValueIds && preselectOptionValueIds.length > 0 ? { preselectOptionValueIds } : {}),
  }
})

// What every RSC block half calls. A null here is not a failure: it means we
// could not tell server-side which product this is (a layout that renders our
// blocks outside shop's product detail, say), and the island falls back to the
// fetch it has always done.
export async function bootstrapForCurrentProduct(): Promise<VariationBootstrap | null> {
  const slug = currentProductSlug()
  if (!slug) return null
  return getVariationBootstrap(slug)
}
