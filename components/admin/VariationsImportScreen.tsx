'use client'

import { useState } from 'react'
import { VariationsTabs } from '@/modules/shop-variations/components/admin/VariationsTabs'
import { ExportColumnsModal } from '@/modules/shop/components/admin/ExportColumnsModal'
import { VARIATIONS_EXPORT_GROUPS, VARIATIONS_REQUIRED_COLUMNS } from '@/modules/shop-variations/lib/export-columns'

type ImportResult = { created: number; updated: number; errors: Array<{ row: number; reason: string }> }

// Every kind the picker can offer - the fixed columns plus the two moving blocks.
// Ticking the lot is the old download, so the url carries no `columns` at all.
const ALL_EXPORT_KINDS = VARIATIONS_EXPORT_GROUPS.reduce((n, g) => n + g.columns.length, 0)

function exportHref(keys: string[]): string {
  if (keys.length === ALL_EXPORT_KINDS) return '/api/m/shop-variations/admin/export'
  return `/api/m/shop-variations/admin/export?columns=${encodeURIComponent(keys.join(','))}`
}

export function VariationsImportScreen() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

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

      {exportOpen && (
        <ExportColumnsModal
          title="Export variations to CSV"
          description="Tick the columns you want in the file. Variant ID stays put - it is how each row finds its way back to the right variant when you upload the file again."
          groups={VARIATIONS_EXPORT_GROUPS}
          storageKey="shop-variations.export.columns"
          requiredKeys={VARIATIONS_REQUIRED_COLUMNS}
          buildHref={exportHref}
          onClose={() => setExportOpen(false)}
        />
      )}
      <VariationsTabs active="import" />

      <div style={{ display: 'grid', gap: '1.5rem', maxWidth: 640 }}>
        <section style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '1rem 1.25rem' }}>
          <h2 style={{ fontSize: '1.0625rem', marginTop: 0 }}>Export</h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>Download every variant as a CSV - one row per variant, with its options and per-variant price, stock, SKU, barcode and weight.</p>
          <button type="button" className="btn btn-secondary" onClick={() => setExportOpen(true)}>Download variations CSV</button>
        </section>

        <section style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '1rem 1.25rem' }}>
          <h2 style={{ fontSize: '1.0625rem', marginTop: 0 }}>Import</h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            Upload a CSV in the same shape. Parent products are matched by their slug (create them in the shop first); options and variant child products are created or updated to match.
          </p>
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
          {busy && <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Importing…</p>}
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
