import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { getProductById } from '@/modules/shop/lib/db/products'
import { VariationsEditorScreen } from '@/modules/shop-variations/components/admin/VariationsEditorScreen'

export const metadata = { title: 'Manage variations — Admin' }

export default async function VariationsEditorPage({ params }: { params: Promise<{ productId: string }> }) {
  const user = await getSessionFromCookie()
  if (!user) return null
  const canAccess = await hasShopPermission(user, 'shop.products')
  if (!canAccess) return <div className="alert alert-danger">You do not have permission to manage product options.</div>

  const { productId } = await params
  const product = await getProductById(productId)
  if (!product || product.catalogueHidden) return <div className="alert alert-danger">Product not found.</div>

  return <VariationsEditorScreen productId={productId} productName={product.name} />
}
