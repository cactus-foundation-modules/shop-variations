import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { VariationsListScreen } from '@/modules/shop-variations/components/admin/VariationsListScreen'

export const metadata = { title: 'Product options — Admin' }

export default async function VariationsProductsPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  const canAccess = await hasShopPermission(user, 'shop.products', { allowAccess: true })
  if (!canAccess) return <div className="alert alert-danger">You do not have permission to manage product options.</div>

  return <VariationsListScreen />
}
