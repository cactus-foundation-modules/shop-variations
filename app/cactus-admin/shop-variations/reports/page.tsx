import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { VariationsReportScreen } from '@/modules/shop-variations/components/admin/VariationsReportScreen'

export const metadata = { title: 'Variant reports — Admin' }

export default async function VariationsReportsPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  const canAccess = await hasShopPermission(user, 'shop.reports', { allowAccess: true })
  if (!canAccess) return <div className="alert alert-danger">You do not have permission to view Shop reports.</div>

  return <VariationsReportScreen />
}
