import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { VariationsImportScreen } from '@/modules/shop-variations/components/admin/VariationsImportScreen'

export const metadata = { title: 'Import variations — Admin' }

export default async function VariationsImportPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  const canAccess = await hasShopPermission(user, 'shop.products')
  if (!canAccess) return <div className="alert alert-danger">You do not have permission to manage product options.</div>

  return <VariationsImportScreen />
}
