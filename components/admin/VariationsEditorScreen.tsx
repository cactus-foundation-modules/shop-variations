'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAdminPath } from '@/components/admin/AdminPathContext'
import { PersonalisationEditor } from '@/modules/shop-variations/components/admin/PersonalisationEditor'
import type { SvrAddon } from '@/modules/shop-variations/lib/types'

type OptionValue = { id: string; label: string; swatch: string | null; position: number }
type Option = { id: string; name: string; controlType: 'DROPDOWN' | 'SWATCH' | 'PILL'; position: number; values: OptionValue[] }
type VariantRow = {
  variantId: string; childProductId: string; optionValueIds: string[]; label: string
  enabled: boolean; price: number; sku: string | null; barcode: string | null
  trackInventory: boolean; stockCount: number | null; weight: number | null; imageUrl: string | null
}
type Payload = {
  product: { id: string; name: string; price: number }
  options: Option[]
  variants: VariantRow[]
  addons: SvrAddon[]
}

const CONTROL_LABELS: Record<string, string> = { DROPDOWN: 'Dropdown', SWATCH: 'Colour swatch', PILL: 'Pills' }

export function VariationsEditorScreen({ productId, productName }: { productId: string; productName: string }) {
  const adminPath = useAdminPath()
  const [data, setData] = useState<Payload | null>(null)
  const [currency, setCurrency] = useState('£')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/m/shop-variations/admin/products/${productId}`)
    if (res.ok) setData(await res.json())
  }, [productId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- both are async helpers; setState only runs after an await, never synchronously in the effect
    refresh()
    fetch('/api/m/shop/public/config').then(async (r) => { if (r.ok) setCurrency((await r.json()).currencySymbol ?? '£') }).catch(() => {})
  }, [refresh])

  // --- Options -------------------------------------------------------------
  const [newOptionName, setNewOptionName] = useState('')
  const [newOptionType, setNewOptionType] = useState<'DROPDOWN' | 'SWATCH' | 'PILL'>('DROPDOWN')
  const [newOptionValues, setNewOptionValues] = useState('')

  async function addOption() {
    if (!newOptionName.trim()) return
    const values = newOptionValues.split(',').map((s) => s.trim()).filter(Boolean).map((label) => ({ label }))
    setBusy(true)
    await fetch(`/api/m/shop-variations/admin/products/${productId}/options`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newOptionName.trim(), controlType: newOptionType, values }),
    })
    setNewOptionName(''); setNewOptionValues(''); setNewOptionType('DROPDOWN')
    await refresh(); setBusy(false)
  }

  async function deleteOption(id: string) {
    setBusy(true)
    await fetch(`/api/m/shop-variations/admin/options/${id}`, { method: 'DELETE' })
    await refresh(); setBusy(false)
  }

  async function addValue(optionId: string, label: string, swatch: string | null) {
    if (!label.trim()) return
    setBusy(true)
    await fetch(`/api/m/shop-variations/admin/options/${optionId}/values`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label.trim(), swatch: swatch || null }),
    })
    await refresh(); setBusy(false)
  }

  async function deleteValue(id: string) {
    setBusy(true)
    await fetch(`/api/m/shop-variations/admin/option-values/${id}`, { method: 'DELETE' })
    await refresh(); setBusy(false)
  }

  // --- Matrix --------------------------------------------------------------
  async function generate() {
    setBusy(true); setMessage(null)
    const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/generate-matrix`, { method: 'POST' })
    const body = await res.json()
    if (res.ok) setMessage(`${body.total} variant${body.total === 1 ? '' : 's'} in total (${body.created} added, ${body.removed} removed).`)
    else setMessage(body.error ?? 'Could not generate variants')
    await refresh(); setBusy(false)
  }

  async function clearAll() {
    if (!window.confirm('Delete all variants for this product? This removes their hidden child products too.')) return
    setBusy(true)
    await fetch(`/api/m/shop-variations/admin/products/${productId}/clear-variants`, { method: 'POST' })
    await refresh(); setBusy(false)
  }

  // --- Per-variant edits ---------------------------------------------------
  async function saveVariant(variantId: string, patch: Record<string, unknown>) {
    await fetch(`/api/m/shop-variations/admin/variants/${variantId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
  }

  function patchLocalVariant(variantId: string, patch: Partial<VariantRow>) {
    setData((d) => d ? { ...d, variants: d.variants.map((v) => v.variantId === variantId ? { ...v, ...patch } : v) } : d)
  }

  async function bulkSet(field: 'price' | 'stockCount', value: number) {
    if (!data) return
    setBusy(true)
    for (const v of data.variants) {
      await saveVariant(v.variantId, { [field]: value })
    }
    await refresh(); setBusy(false)
  }

  if (!data) return null

  const input = { padding: '0.375rem 0.5rem', borderRadius: 6, border: '1px solid var(--color-border)', width: '100%' } as const
  const numInput = { ...input, width: 90 } as const

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <a className="btn btn-secondary btn-sm" href={`/${adminPath}/m/shop-variations/products`}>← All</a>
        <h1 className="page-title" style={{ margin: 0 }}>Variations — {productName}</h1>
      </div>

      {/* Options */}
      <section style={{ display: 'grid', gap: '0.75rem' }}>
        <h2 style={{ fontSize: '1.125rem', margin: 0 }}>Options</h2>
        {data.options.length === 0 && <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>No options yet. Add one below (e.g. Size, Colour), then generate the variants.</p>}
        {data.options.map((opt) => (
          <div key={opt.id} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.75rem 1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <strong>{opt.name}</strong>
              <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{CONTROL_LABELS[opt.controlType]}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => deleteOption(opt.id)} disabled={busy}>Remove</button>
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginTop: '0.5rem', alignItems: 'center' }}>
              {opt.values.map((v) => (
                <span key={v.id} style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center', background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 999, padding: '0.125rem 0.5rem', fontSize: '0.8125rem' }}>
                  {opt.controlType === 'SWATCH' && v.swatch && <span aria-hidden style={{ width: 12, height: 12, borderRadius: 999, background: v.swatch, border: '1px solid var(--color-border)' }} />}
                  {v.label}
                  <button aria-label={`Remove ${v.label}`} onClick={() => deleteValue(v.id)} disabled={busy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>×</button>
                </span>
              ))}
              <AddValueInline optionId={opt.id} isSwatch={opt.controlType === 'SWATCH'} onAdd={addValue} disabled={busy} />
            </div>
          </div>
        ))}

        <div style={{ border: '1px dashed var(--color-border)', borderRadius: 8, padding: '0.75rem 1rem', display: 'grid', gap: '0.5rem' }}>
          <strong style={{ fontSize: '0.875rem' }}>Add an option</strong>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input placeholder="Name (e.g. Size)" value={newOptionName} onChange={(e) => setNewOptionName(e.target.value)} style={{ ...input, width: 160 }} />
            <select value={newOptionType} onChange={(e) => setNewOptionType(e.target.value as typeof newOptionType)} style={{ ...input, width: 150 }}>
              <option value="DROPDOWN">Dropdown</option>
              <option value="PILL">Pills</option>
              <option value="SWATCH">Colour swatch</option>
            </select>
            <input placeholder="Values, comma separated (S, M, L)" value={newOptionValues} onChange={(e) => setNewOptionValues(e.target.value)} style={{ ...input, flex: 1, minWidth: 200 }} />
            <button className="btn btn-primary btn-sm" onClick={addOption} disabled={busy || !newOptionName.trim()}>Add option</button>
          </div>
        </div>
      </section>

      {/* Matrix controls */}
      <section style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={generate} disabled={busy || data.options.length === 0}>Generate variants</button>
        {data.variants.length > 0 && <button className="btn btn-secondary" onClick={clearAll} disabled={busy}>Clear all variants</button>}
        {message && <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{message}</span>}
      </section>

      {/* Bulk grid */}
      {data.variants.length > 0 && (
        <section style={{ display: 'grid', gap: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.125rem', margin: 0 }}>Variants ({data.variants.length})</h2>
            <BulkControls currency={currency} onSetPrice={(v) => bulkSet('price', v)} onSetStock={(v) => bulkSet('stockCount', v)} disabled={busy} />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '0.5rem' }}>Variant</th>
                  <th style={{ padding: '0.5rem' }}>Image</th>
                  <th style={{ padding: '0.5rem' }}>Price</th>
                  <th style={{ padding: '0.5rem' }}>SKU</th>
                  <th style={{ padding: '0.5rem' }}>Stock</th>
                  <th style={{ padding: '0.5rem' }}>Weight</th>
                  <th style={{ padding: '0.5rem' }}>On</th>
                </tr>
              </thead>
              <tbody>
                {data.variants.map((v) => (
                  <tr key={v.variantId} style={{ borderBottom: '1px solid var(--color-border)', opacity: v.enabled ? 1 : 0.55 }}>
                    <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{v.label || '—'}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <ImageCell
                        url={v.imageUrl}
                        onSet={(url) => { patchLocalVariant(v.variantId, { imageUrl: url }); saveVariant(v.variantId, { imageUrl: url }) }}
                      />
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        {currency}
                        <input
                          type="number" min={0} step="0.01" defaultValue={v.price} style={numInput}
                          onBlur={(e) => saveVariant(v.variantId, { price: Number(e.target.value) })}
                        />
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <input defaultValue={v.sku ?? ''} placeholder="SKU" style={{ ...input, width: 120 }} onBlur={(e) => saveVariant(v.variantId, { sku: e.target.value || null })} />
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <input type="number" step="1" defaultValue={v.stockCount ?? ''} placeholder="—" style={numInput} onBlur={(e) => saveVariant(v.variantId, { stockCount: e.target.value === '' ? null : Number(e.target.value) })} />
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <input type="number" min={0} step="0.001" defaultValue={v.weight ?? ''} placeholder="—" style={numInput} onBlur={(e) => saveVariant(v.variantId, { weight: e.target.value === '' ? null : Number(e.target.value) })} />
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <input type="checkbox" defaultChecked={v.enabled} onChange={(e) => { patchLocalVariant(v.variantId, { enabled: e.target.checked }); saveVariant(v.variantId, { enabled: e.target.checked }) }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Personalisation add-ons */}
      <PersonalisationEditor productId={productId} addons={data.addons} currency={currency} onChange={refresh} />
    </div>
  )
}

function AddValueInline({ optionId, isSwatch, onAdd, disabled }: { optionId: string; isSwatch: boolean; onAdd: (optionId: string, label: string, swatch: string | null) => void; disabled: boolean }) {
  const [label, setLabel] = useState('')
  const [swatch, setSwatch] = useState('#000000')
  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
      <input
        placeholder="Add value" value={label} onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { onAdd(optionId, label, isSwatch ? swatch : null); setLabel('') } }}
        style={{ padding: '0.25rem 0.5rem', borderRadius: 6, border: '1px solid var(--color-border)', width: 110, fontSize: '0.8125rem' }}
      />
      {isSwatch && <input type="color" aria-label="Swatch colour" value={swatch} onChange={(e) => setSwatch(e.target.value)} style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--color-border)', borderRadius: 6 }} />}
      <button className="btn btn-secondary btn-sm" onClick={() => { onAdd(optionId, label, isSwatch ? swatch : null); setLabel('') }} disabled={disabled || !label.trim()}>+</button>
    </span>
  )
}

function BulkControls({ currency, onSetPrice, onSetStock, disabled }: { currency: string; onSetPrice: (v: number) => void; onSetStock: (v: number) => void; disabled: boolean }) {
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')
  const small = { padding: '0.25rem 0.5rem', borderRadius: 6, border: '1px solid var(--color-border)', width: 80, fontSize: '0.8125rem' } as const
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8125rem' }}>
      <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
        {currency}<input type="number" min={0} step="0.01" placeholder="price" value={price} onChange={(e) => setPrice(e.target.value)} style={small} />
        <button className="btn btn-secondary btn-sm" disabled={disabled || price === ''} onClick={() => onSetPrice(Number(price))}>Set all</button>
      </span>
      <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
        <input type="number" step="1" placeholder="stock" value={stock} onChange={(e) => setStock(e.target.value)} style={small} />
        <button className="btn btn-secondary btn-sm" disabled={disabled || stock === ''} onClick={() => onSetStock(Number(stock))}>Set all</button>
      </span>
    </div>
  )
}

function ImageCell({ url, onSet }: { url: string | null; onSet: (url: string | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(url ?? '')
  if (editing) {
    return (
      <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
        <input placeholder="Image URL" value={value} onChange={(e) => setValue(e.target.value)} style={{ padding: '0.25rem 0.5rem', borderRadius: 6, border: '1px solid var(--color-border)', width: 160, fontSize: '0.8125rem' }} />
        <button className="btn btn-secondary btn-sm" onClick={() => { onSet(value || null); setEditing(false) }}>Save</button>
      </span>
    )
  }
  return (
    <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} aria-label="Set variant image">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--color-border)' }} />
      ) : (
        <span style={{ width: 36, height: 36, borderRadius: 6, border: '1px dashed var(--color-border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>＋</span>
      )}
    </button>
  )
}
