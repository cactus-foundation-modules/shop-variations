// Request-scoped batch cache for the cart-line add-on resolver. Per line the
// resolver looks up the line's owner product (a variant child's add-ons live on
// its parent) and that owner's add-ons - two queries per line, so a whole cart
// fanned out into dozens of round-trips. Shop's cart-line-resolver prefetch hook
// calls prefetchAddons once with the whole cart, mapping every line to its owner
// and loading all owners' add-ons in two batched queries; the per-line resolver
// then reads from the cache. Without a prefetch (an older shop) getAddonsForLine
// falls back to the original per-line lookups, so the resolver still works.
import { cache } from 'react'
import type { ShpProduct } from '@/modules/shop/lib/types'
import type { SvrAddon } from '@/modules/shop-variations/lib/types'
import { getAddons, getAddonsForProducts } from '@/modules/shop-variations/lib/db/addons'
import { getVariantByChildProductId, getVariantParentsByChild } from '@/modules/shop-variations/lib/db/variants'

type AddonStore = {
  ownerByProduct: Map<string, string>
  addonsByOwner: Map<string, SvrAddon[]>
  prefetched: boolean
}

// One store per request (see delivery-cache in advanced-shipping for the same
// cache() pattern).
const requestStore = cache((): AddonStore => ({
  ownerByProduct: new Map(),
  addonsByOwner: new Map(),
  prefetched: false,
}))

// Map every cart product to its add-on owner (itself, or its parent when it is a
// hidden variant child) and load all owners' add-ons in two batched queries.
export async function prefetchAddons(products: ShpProduct[]): Promise<void> {
  const store = requestStore()
  const hiddenChildIds = products.filter((p) => p.catalogueHidden).map((p) => p.id)
  const parentByChild = await getVariantParentsByChild(hiddenChildIds)

  const ownerIds = new Set<string>()
  for (const product of products) {
    const owner = parentByChild.get(product.id) ?? product.id
    store.ownerByProduct.set(product.id, owner)
    ownerIds.add(owner)
  }

  const addonsByOwner = await getAddonsForProducts([...ownerIds])
  for (const [owner, list] of addonsByOwner) store.addonsByOwner.set(owner, list)
  store.prefetched = true
}

// The add-ons for one cart line's product, served from the request batch when
// shop prefetched. Falls back to the original per-line owner + add-on lookups
// when no prefetch has run.
export async function getAddonsForLine(product: ShpProduct): Promise<SvrAddon[]> {
  const store = requestStore()
  if (store.prefetched) {
    const owner = store.ownerByProduct.get(product.id)
    if (owner) return store.addonsByOwner.get(owner) ?? []
    // Not in the prefetch set (not expected on the cart path) - resolve directly.
  }

  let ownerId = product.id
  if (product.catalogueHidden) {
    const variant = await getVariantByChildProductId(product.id)
    if (variant) ownerId = variant.productId
  }
  return getAddons(ownerId)
}
