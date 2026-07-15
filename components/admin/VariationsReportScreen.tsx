'use client'

import { useEffect, useState } from 'react'
import { VariationsTabs } from '@/modules/shop-variations/components/admin/VariationsTabs'

type VariantRow = { childId: string; name: string; units: number; revenue: number }
type ParentReport = {
  parentId: string; parentName: string; totalUnits: number; totalRevenue: number
  variants: VariantRow[]; best: VariantRow | null; worst: VariantRow | null
}

export function VariationsReportScreen() {
  const [report, setReport] = useState<ParentReport[]>([])
  const [currency, setCurrency] = useState('£')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/m/shop-variations/admin/reports').then((r) => r.json()),
      fetch('/api/m/shop/public/config').then((r) => r.json()).catch(() => ({})),
    ]).then(([data, config]) => {
      if (cancelled) return
      setReport(data.report ?? [])
      if (config.currencySymbol) setCurrency(config.currencySymbol)
      setLoaded(true)
    }).catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const money = (n: number) => `${currency}${n.toFixed(2)}`

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Variant reports</h1></div>
      <VariationsTabs active="reports" />

      {!loaded ? null : report.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No variant sales yet. Once orders come in for products with variations, they&apos;ll roll up here.</p>
      ) : (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {report.map((p) => (
            <section key={p.parentId} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: '1.0625rem', margin: 0 }}>{p.parentName}</h2>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{p.totalUnits} sold · {money(p.totalRevenue)}</span>
              </div>
              {(p.best || p.worst) && (
                <p style={{ margin: '0.5rem 0 0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                  {p.best && <>Best: <strong>{p.best.name}</strong> ({p.best.units}). </>}
                  {p.worst && <>Slowest: <strong>{p.worst.name}</strong> ({p.worst.units}).</>}
                </p>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ padding: '0.375rem 0.5rem' }}>Variant</th>
                    <th style={{ padding: '0.375rem 0.5rem', textAlign: 'right' }}>Units</th>
                    <th style={{ padding: '0.375rem 0.5rem', textAlign: 'right' }}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {p.variants.map((v) => (
                    <tr key={v.childId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '0.375rem 0.5rem' }}>{v.name}</td>
                      <td style={{ padding: '0.375rem 0.5rem', textAlign: 'right' }}>{v.units}</td>
                      <td style={{ padding: '0.375rem 0.5rem', textAlign: 'right' }}>{money(v.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
