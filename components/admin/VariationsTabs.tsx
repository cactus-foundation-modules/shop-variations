'use client'

import { useAdminPath } from '@/components/admin/AdminPathContext'

// Small sub-nav shared by the variations admin pages, so the module keeps a
// single Shop-group nav entry ("Variation tools") for the reports and import
// screens. Browsing and editing variations themselves now lives on the
// Variations tab of Shop > Products, not here.
const TABS = [
  { key: 'import', label: 'Import / export', href: 'import' },
  { key: 'reports', label: 'Reports', href: 'reports' },
] as const

export function VariationsTabs({ active }: { active: 'reports' | 'import' }) {
  const adminPath = useAdminPath()
  return (
    <nav style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--color-border)', marginBottom: '1.25rem' }}>
      {TABS.map((t) => (
        <a
          key={t.key}
          href={`/${adminPath}/m/shop-variations/${t.href}`}
          style={{
            padding: '0.5rem 0.875rem', textDecoration: 'none', fontSize: '0.875rem', fontWeight: active === t.key ? 600 : 400,
            color: active === t.key ? 'var(--color-text)' : 'var(--color-text-muted)',
            borderBottom: `2px solid ${active === t.key ? 'var(--color-primary)' : 'transparent'}`,
          }}
        >
          {t.label}
        </a>
      ))}
    </nav>
  )
}
