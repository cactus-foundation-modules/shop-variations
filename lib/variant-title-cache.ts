// Request-scoped batch cache for variant cart-line titles. A variant child's
// cart name is its parent's name plus the chosen options ("Parent - Red / L");
// the cart wants those two parts on separate lines (base name, then options).
// Per line that would be a parent-product lookup, so a whole cart fans out into
// a query per variant line. Shop's cart-line-resolver prefetch hook calls
// prefetchVariantTitles once with the whole cart, resolving every variant child
// to its parent in one batched pass; the per-line resolver then reads a ready
// title from the cache. Without a prefetch (an older shop) buildVariantTitle
// falls back to the original per-line lookup, so the resolver still works.
//
// Mirrors addon-cache.ts (and advanced-shipping's delivery-cache) - same cache()
// request-store pattern.
import { cache } from 'react'
import type { ShpProduct } from '@/modules/shop/lib/types'
import type { CartLineMinOrder, CartLineTitle } from '@/modules/shop/lib/line-meta'
import { resolveMinOrderQuantity } from '@/modules/shop/lib/min-order'
import { getProductById, getProductsByIds } from '@/modules/shop/lib/db/products'
import { getVariantByChildProductId, getVariantParentsByChild } from '@/modules/shop-variations/lib/db/variants'

type TitleStore = {
  titleByProduct: Map<string, CartLineTitle>
  // Which parent listing each variant child belongs to, and that parent's own
  // minimum order. Filled by the same batched pass as the titles, because the
  // cart-line resolver needs all three and they come out of one lookup - see
  // getVariantMinOrder.
  parentByProduct: Map<string, string>
  parentMinByProduct: Map<string, number | null>
  prefetched: boolean
}

// One store per request (see addon-cache for the same cache() pattern).
const requestStore = cache((): TitleStore => ({
  titleByProduct: new Map(),
  parentByProduct: new Map(),
  parentMinByProduct: new Map(),
  prefetched: false,
}))

// The variation part of a child's name is exactly its name with the parent's
// name and " - " separator stripped - authoritative, so we never have to guess
// at a " - " the parent name might itself contain. Falls back to the last " - "
// only if the expected prefix is somehow absent (a hand-renamed child).
function splitTitle(childName: string, parentName: string): CartLineTitle {
  const prefix = `${parentName} - `
  if (childName.startsWith(prefix) && childName.length > prefix.length) {
    return { name: parentName, secondary: childName.slice(prefix.length) }
  }
  const at = childName.lastIndexOf(' - ')
  return at > 0 ? { name: childName.slice(0, at), secondary: childName.slice(at + 3) } : { name: childName }
}

// Resolve every variant child in the cart to its parent's name in one batched
// pass (two queries: child->parent map, then the parents), and cache the split
// title per child. Non-variant products carry no title and are skipped.
export async function prefetchVariantTitles(products: ShpProduct[]): Promise<void> {
  const store = requestStore()
  const children = products.filter((p) => p.catalogueHidden)
  if (children.length > 0) {
    const parentByChild = await getVariantParentsByChild(children.map((p) => p.id))
    const parents = await getProductsByIds([...new Set(parentByChild.values())])
    for (const child of children) {
      const parentId = parentByChild.get(child.id)
      if (parentId) store.parentByProduct.set(child.id, parentId)
      const parent = parentId ? parents.get(parentId) : undefined
      if (parent) {
        store.titleByProduct.set(child.id, splitTitle(child.name, parent.name))
        store.parentMinByProduct.set(child.id, parent.minOrderQuantity)
      }
    }
  }
  store.prefetched = true
}

// The cart-display title for one line: base name + chosen options for a variant
// child, null for anything else (the cart then shows the product's own name).
// Served from the request batch when shop prefetched; falls back to a direct
// parent lookup otherwise.
export async function buildVariantTitle(product: ShpProduct): Promise<CartLineTitle | null> {
  if (!product.catalogueHidden) return null
  const store = requestStore()
  if (store.prefetched) return store.titleByProduct.get(product.id) ?? null

  const variant = await getVariantByChildProductId(product.id)
  if (!variant) return null
  const parent = await getProductById(variant.productId)
  if (!parent) return null
  return splitTitle(product.name, parent.name)
}

// Everything shop needs to hold a variation to its listing's minimum order: the
// listing this line is a way of buying, and the figure that listing actually
// asks for. Null for anything that is not a variation.
//
// The quantity matters as much as the key. A variation child's own
// `min_order_quantity` is very nearly always blank - the owner sets one figure
// on the product, which is the whole point of the fallback - so shop reading the
// child row alone saw no minimum at all and let a basket of one through the
// checkout while the product page insisted on four. Only this module can see the
// parent, so only this module can answer it.
//
// Served from the same request batch as the titles; falls back to the direct
// lookups when shop did not prefetch, exactly as buildVariantTitle does.
export async function getVariantMinOrder(product: ShpProduct): Promise<CartLineMinOrder | null> {
  if (!product.catalogueHidden) return null
  const store = requestStore()
  if (store.prefetched) {
    const key = store.parentByProduct.get(product.id)
    if (!key) return null
    // parentMinByProduct is keyed by CHILD id, like every other map here.
    return { key, quantity: resolveMinOrderQuantity(product.minOrderQuantity, store.parentMinByProduct.get(product.id) ?? null) }
  }

  const variant = await getVariantByChildProductId(product.id)
  if (!variant) return null
  const parent = await getProductById(variant.productId)
  return {
    key: variant.productId,
    quantity: resolveMinOrderQuantity(product.minOrderQuantity, parent?.minOrderQuantity ?? null),
  }
}
