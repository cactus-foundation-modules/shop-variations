import { getProductById } from '@/modules/shop/lib/db'
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { GalleryOrderPanel } from '@/modules/shop-variations/components/admin/GalleryOrderPanel'

// The gallery-order tick box on the product editor's Images tab, contributed
// through the shop.product-editor-media-sections point. Server component: it only
// decides whether this product has variations to order the gallery against, then
// hands off to the client panel, which registers its edit with the editor's
// single Save button.

export async function ProductGalleryOrderSection({ productId }: { productId: string }) {
  const product = await getProductById(productId)

  // A variant child is edited from its parent's Variations tab, never opened in
  // its own right, and has no variations of its own to promote.
  if (!product || product.catalogueHidden) return null

  // Nothing to sit behind on a product with no options: the setting would be a
  // switch wired to nothing, on the great majority of products.
  const options = await getOptionsWithValues(productId)
  if (options.length === 0) return null

  return <GalleryOrderPanel productId={productId} />
}
