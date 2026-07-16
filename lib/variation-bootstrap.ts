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
import { getVariantSelectorPayloadBySlug } from '@/modules/shop-variations/lib/variants-service'
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

// One payload per product per request, however many blocks ask for it: the
// composite block alone would otherwise repeat this query five times over.
export const getVariationBootstrap = cache(async (slug: string): Promise<VariationBootstrap | null> => {
  const [payload, config] = await Promise.all([
    getVariantSelectorPayloadBySlug(slug),
    getShopConfigCached(),
  ])
  if (!payload) return null
  return { payload, currencySymbol: config.currencySymbol }
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
