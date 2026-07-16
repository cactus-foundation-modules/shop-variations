import { getProductById } from '@/modules/shop/lib/db'
import { VariationsPanel } from '@/modules/shop-variations/components/admin/VariationsPanel'

// The Variations tab on the shop product editor, contributed through the
// shop.product-editor-sections point. Server component: it only decides whether
// this product can carry variations at all, then hands off to the client panel,
// which registers its own edits with the editor's single Save button.
export async function ProductVariationsSection({ productId }: { productId: string }) {
  const product = await getProductById(productId)

  // Variant children are themselves products, but a variant of a variant is not a
  // thing. The service refuses it, so do not offer it.
  if (!product || product.catalogueHidden) return null

  return <VariationsPanel productId={productId} />
}
