'use client'

import { useEffect, useState } from 'react'
import { useAdminPath } from '@/components/admin/AdminPathContext'
import { VariationsTabs } from '@/modules/shop-variations/components/admin/VariationsTabs'

type Row = { id: string; name: string; slug: string; variantCount: number; addonCount: number }

// Lists every product that has options, variants or add-ons and links into the
// deep editor. Products gain variations from their own editor (via the inline
// section), so this is a management overview rather than a create screen.
export function VariationsListScreen() {
  const adminPath = useAdminPath()
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/m/shop-variations/admin/products')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setRows(d.products ?? []); setLoaded(true) } })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Product options</h1></div>
      <VariationsTabs active="products" />

      {!loaded ? null : rows.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>
          No products have variations yet. Open a product in the shop and use the
          &ldquo;Variations &amp; personalisation&rdquo; section to add options or personalisation fields.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ padding: '0.5rem' }}>Product</th>
              <th style={{ padding: '0.5rem' }}>Variants</th>
              <th style={{ padding: '0.5rem' }}>Personalisation</th>
              <th style={{ padding: '0.5rem' }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '0.5rem' }}>{r.name}</td>
                <td style={{ padding: '0.5rem' }}>{r.variantCount}</td>
                <td style={{ padding: '0.5rem' }}>{r.addonCount}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                  <a className="btn btn-secondary btn-sm" href={`/${adminPath}/m/shop-variations/products/${r.id}`}>Manage</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
