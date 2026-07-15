'use client'

import { useState } from 'react'
import Link from 'next/link'
import { VariationsTabs } from '@/modules/shop-variations/components/admin/VariationsTabs'

type ImportResult = { created: number; updated: number; errors: Array<{ row: number; reason: string }> }

export function VariationsImportScreen() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onFile(file: File) {
    setBusy(true); setError(null); setResult(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/m/shop-variations/admin/import', { method: 'POST', body: form })
      const data = await res.json()
      if (res.ok) setResult(data)
      else setError(data.error ?? 'Import failed')
    } catch {
      setError('Import failed')
    }
    setBusy(false)
  }

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Import / export</h1></div>
      <VariationsTabs active="import" />

      <div style={{ display: 'grid', gap: '1.5rem', maxWidth: 640 }}>
        <section style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '1rem 1.25rem' }}>
          <h2 style={{ fontSize: '1.0625rem', marginTop: 0 }}>Export</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Download every variant as a CSV - one row per variant, with its options and per-variant price, stock, SKU, barcode and weight.</p>
          <Link className="btn btn-secondary" href="/api/m/shop-variations/admin/export">Download variations CSV</Link>
        </section>

        <section style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '1rem 1.25rem' }}>
          <h2 style={{ fontSize: '1.0625rem', marginTop: 0 }}>Import</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            Upload a CSV in the same shape. Parent products are matched by their slug (create them in the shop first); options and variant child products are created or updated to match.
          </p>
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
          {busy && <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Importing…</p>}
          {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
          {result && (
            <div style={{ marginTop: '0.75rem' }}>
              <p style={{ margin: 0, fontWeight: 600 }}>{result.created} created, {result.updated} updated{result.errors.length > 0 ? `, ${result.errors.length} skipped` : ''}.</p>
              {result.errors.length > 0 && (
                <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '0.8125rem', color: 'var(--color-danger)' }}>
                  {result.errors.slice(0, 50).map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
