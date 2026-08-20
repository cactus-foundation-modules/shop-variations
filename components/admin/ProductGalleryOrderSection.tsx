import { getProductById } from '@/modules/shop/lib/db'
import { getOptionsWithValues } from '@/modules/shop-variations/lib/db/options'
import { GalleryVariationImagesPanel } from '@/modules/shop-variations/components/admin/GalleryVariationImagesPanel'

// This module's contribution to the product editor's Images tab, through the
// shop.product-editor-media-sections point: the variations promoted with "Image
// up front", drawn as tiles among the product's own photographs and dragged
// about with them. Server component: it only decides whether this product has
// variations to promote at all, then hands off to the client panel, which
// registers the tiles and its edit with the editor's single Save button.

export async function ProductGalleryOrderSection({ productId }: { productId: string }) {
  const product = await getProductById(productId)

  // A variant child is edited from its parent's Variations tab, never opened in
  // its own right, and has no variations of its own to promote.
  if (!product || product.catalogueHidden) return null

  // Nothing to promote on a product with no options, which is the great majority
  // of them - so the note underneath the grid stays off those screens entirely.
  const options = await getOptionsWithValues(productId)
  if (options.length === 0) return null

  return <GalleryVariationImagesPanel productId={productId} />
}
