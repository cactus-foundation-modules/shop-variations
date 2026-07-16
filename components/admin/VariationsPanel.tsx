'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { MediaPickerModal } from '@/modules/shop/components/admin/MediaPickerModal'
import {
  useProductEditorCurrency, useProductEditorSave, useProductEditorTabBadge,
} from '@/modules/shop/components/admin/product-editor/context'
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

type VariantEdit = Partial<Pick<VariantRow, 'price' | 'sku' | 'stockCount' | 'weight' | 'enabled' | 'imageUrl'>>

const CONTROL_LABELS: Record<Option['controlType'], string> = { DROPDOWN: 'Dropdown', SWATCH: 'Colour swatch', PILL: 'Pills' }

/**
 * The Variations tab on the shop's product editor.
 *
 * Two kinds of change live here and they behave differently on purpose.
 * Structural work (adding an option, generating the matrix, adding a
 * personalisation field) applies as soon as you do it, because it is an action
 * rather than a form field. Per-variant edits in the grid are ordinary form
 * fields, so they are held locally and written by the product editor's own Save
 * button alongside everything else.
 */
export function VariationsPanel({ productId }: { productId: string }) {
  const currency = useProductEditorCurrency()
  const [data, setData] = useState<Payload | null>(null)
  const [edits, setEdits] = useState<Record<string, VariantEdit>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [optionError, setOptionError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/m/shop-variations/admin/products/${productId}`)
    if (res.ok) setData(await res.json())
  }, [productId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async helper; setData only runs after an await, never synchronously in the effect body
  useEffect(() => { void refresh() }, [refresh])

  // --- Register with the product editor's Save button -----------------------
  const dirty = Object.keys(edits).length > 0

  const save = useCallback(async () => {
    const entries = Object.entries(edits)
    for (const [variantId, patch] of entries) {
      const res = await fetch(`/api/m/shop-variations/admin/variants/${variantId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'One of the variants would not save.')
      }
    }
    // Drop only what was actually written. A row edited while the save was in
    // flight is a different object by now, and must survive to be saved next time
    // rather than be quietly binned.
    setEdits((prev) => {
      const next = { ...prev }
      for (const [variantId, written] of entries) {
        if (next[variantId] === written) delete next[variantId]
      }
      return next
    })
    await refresh()
  }, [edits, refresh])

  useProductEditorSave({ dirty, save })
  useProductEditorTabBadge(data && data.variants.length > 0 ? String(data.variants.length) : null)

  // --- Options -------------------------------------------------------------
  const [newOptionName, setNewOptionName] = useState('')
  const [newOptionType, setNewOptionType] = useState<Option['controlType']>('DROPDOWN')
  const [newOptionValues, setNewOptionValues] = useState('')

  async function rename(url: string, patch: Record<string, string>, fallback: string): Promise<boolean> {
    setBusy(true); setOptionError(null)
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) {
      setOptionError((await res.json().catch(() => ({}))).error ?? fallback)
      setBusy(false)
      return false
    }
    await refresh(); setBusy(false)
    return true
  }

  const renameOption = (id: string, name: string) => rename(`/api/m/shop-variations/admin/options/${id}`, { name }, 'Could not rename that option.')
  const renameValue = (id: string, label: string) => rename(`/api/m/shop-variations/admin/option-values/${id}`, { label }, 'Could not rename that value.')

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
    const body = await res.json().catch(() => ({}))
    setMessage(res.ok
      ? `${body.total} variant${body.total === 1 ? '' : 's'} now (${body.created} added, ${body.removed} removed).`
      : body.error ?? 'Could not work out the variants.')
    await refresh(); setBusy(false)
  }

  async function clearAll() {
    if (!window.confirm('Delete every variant for this product? Their stock counts and prices go with them.')) return
    setBusy(true)
    await fetch(`/api/m/shop-variations/admin/products/${productId}/clear-variants`, { method: 'POST' })
    setEdits({})
    await refresh(); setBusy(false)
  }

  // --- Per-variant edits ---------------------------------------------------
  const editVariant = useCallback((variantId: string, patch: VariantEdit) => {
    setEdits((prev) => ({ ...prev, [variantId]: { ...prev[variantId], ...patch } }))
  }, [])

  const valueOf = useCallback(<K extends keyof VariantEdit>(v: VariantRow, key: K): VariantRow[K] => {
    const edited = edits[v.variantId]?.[key]
    return (edited === undefined ? v[key] : edited) as VariantRow[K]
  }, [edits])

  function bulkSet(field: 'price' | 'stockCount', value: number) {
    if (!data) return
    setEdits((prev) => {
      const next = { ...prev }
      for (const v of data.variants) next[v.variantId] = { ...next[v.variantId], [field]: value }
      return next
    })
  }

  const expectedCount = useMemo(
    () => (data?.options.length ? data.options.reduce((acc, o) => acc * Math.max(o.values.length, 0), 1) : 0),
    [data],
  )
  const matrixStale = data != null && expectedCount > 0 && expectedCount !== data.variants.length

  if (!data) return null

  const input: CSSProperties = { padding: '0.375rem 0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', width: '100%', background: 'var(--color-bg)', color: 'var(--color-text)', font: 'inherit', fontSize: '0.875rem' }
  const numInput: CSSProperties = { ...input, width: 90 }

  return (
    <div className="spe-panel">
      <section className="spe-section">
        <h3 className="spe-section-head">Options</h3>
        <p className="spe-section-blurb">
          The choices a shopper makes before buying, like Size or Colour. Add the options first, then generate the
          combinations underneath.
        </p>

        {optionError && <p className="spe-error" role="alert"><span aria-hidden>⚠</span>{optionError}</p>}

        {data.options.length === 0 ? (
          <p className="spe-empty">No options yet. Add one below and this product stays a plain single item.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {data.options.map((opt) => (
              <div key={opt.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <InlineRename value={opt.name} ariaLabel={`Rename option ${opt.name}`} onSave={(name) => renameOption(opt.id, name)} disabled={busy} inputWidth={160} textStyle={{ fontWeight: 600 }} />
                  <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{CONTROL_LABELS[opt.controlType]}</span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => deleteOption(opt.id)} disabled={busy}>Remove</button>
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginTop: '0.5rem', alignItems: 'center' }}>
                  {opt.values.map((v) => (
                    <span key={v.id} style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center', background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', padding: '0.125rem 0.5rem', fontSize: '0.8125rem' }}>
                      {opt.controlType === 'SWATCH' && v.swatch && <span aria-hidden style={{ width: 12, height: 12, borderRadius: 'var(--radius-full)', background: v.swatch, border: '1px solid var(--color-border)' }} />}
                      <InlineRename value={v.label} ariaLabel={`Rename value ${v.label}`} onSave={(label) => renameValue(v.id, label)} disabled={busy} inputWidth={90} textStyle={{ fontSize: '0.8125rem' }} />
                      <button type="button" aria-label={`Remove ${v.label}`} onClick={() => deleteValue(v.id)} disabled={busy} className="spe-icon-btn spe-icon-btn-danger">×</button>
                    </span>
                  ))}
                  <AddValueInline optionId={opt.id} isSwatch={opt.controlType === 'SWATCH'} onAdd={addValue} disabled={busy} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
          <strong style={{ fontSize: '0.875rem' }}>Add an option</strong>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input placeholder="Name, e.g. Size" value={newOptionName} onChange={(e) => setNewOptionName(e.target.value)} style={{ ...input, width: 160 }} />
            <select value={newOptionType} onChange={(e) => setNewOptionType(e.target.value as Option['controlType'])} style={{ ...input, width: 150 }}>
              <option value="DROPDOWN">Dropdown</option>
              <option value="PILL">Pills</option>
              <option value="SWATCH">Colour swatch</option>
            </select>
            <input placeholder="Values, separated by commas: S, M, L" value={newOptionValues} onChange={(e) => setNewOptionValues(e.target.value)} style={{ ...input, flex: 1, minWidth: 200 }} />
            <button type="button" className="btn btn-primary btn-sm" onClick={addOption} disabled={busy || !newOptionName.trim()}>Add option</button>
          </div>
        </div>
      </section>

      <section className="spe-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h3 className="spe-section-head">Variants{data.variants.length > 0 ? ` (${data.variants.length})` : ''}</h3>
            <p className="spe-section-blurb">
              One row per combination of your options. Give each its own price, stock and picture; untick any you do not
              actually sell.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={generate} disabled={busy || data.options.length === 0}>
              {data.variants.length === 0 ? 'Generate variants' : 'Rebuild from options'}
            </button>
            {data.variants.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={clearAll} disabled={busy}>Delete all</button>}
          </div>
        </div>

        {matrixStale && (
          <div className="alert alert-warning" role="status" style={{ marginBottom: '0.75rem' }}>
            Your options make {expectedCount} combination{expectedCount === 1 ? '' : 's'} but there {data.variants.length === 1 ? 'is' : 'are'} {data.variants.length} here.
            Rebuild from options to catch up.
          </div>
        )}
        {message && <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0 0 0.75rem' }}>{message}</p>}

        {data.variants.length === 0 ? (
          <p className="spe-empty">
            {data.options.length === 0
              ? 'Add an option first, then the combinations show up here.'
              : 'No variants yet. Generate them from the options above.'}
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
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
                    <th style={{ padding: '0.5rem' }}>On sale</th>
                  </tr>
                </thead>
                <tbody>
                  {data.variants.map((v) => {
                    const enabled = valueOf(v, 'enabled')
                    const changed = edits[v.variantId] != null
                    return (
                      <tr key={v.variantId} style={{ borderBottom: '1px solid var(--color-border)', opacity: enabled ? 1 : 0.55, background: changed ? 'var(--color-warning-subtle)' : undefined }}>
                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{v.label || '—'}</td>
                        <td style={{ padding: '0.5rem' }}>
                          <ImageCell url={valueOf(v, 'imageUrl')} onSet={(url) => editVariant(v.variantId, { imageUrl: url })} />
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            {currency}
                            <input
                              type="number" min={0} step="0.01" style={numInput}
                              aria-label={`Price for ${v.label}`}
                              value={String(valueOf(v, 'price'))}
                              onChange={(e) => editVariant(v.variantId, { price: Number(e.target.value) })}
                            />
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          <input
                            style={{ ...input, width: 120 }} placeholder="SKU"
                            aria-label={`SKU for ${v.label}`}
                            value={valueOf(v, 'sku') ?? ''}
                            onChange={(e) => editVariant(v.variantId, { sku: e.target.value || null })}
                          />
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          <input
                            type="number" step="1" style={numInput} placeholder="—"
                            aria-label={`Stock for ${v.label}`}
                            value={valueOf(v, 'stockCount') ?? ''}
                            onChange={(e) => editVariant(v.variantId, { stockCount: e.target.value === '' ? null : Number(e.target.value) })}
                          />
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          <input
                            type="number" min={0} step="0.001" style={numInput} placeholder="—"
                            aria-label={`Weight for ${v.label}`}
                            value={valueOf(v, 'weight') ?? ''}
                            onChange={(e) => editVariant(v.variantId, { weight: e.target.value === '' ? null : Number(e.target.value) })}
                          />
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          <input
                            type="checkbox"
                            aria-label={`${v.label} on sale`}
                            checked={enabled}
                            onChange={(e) => editVariant(v.variantId, { enabled: e.target.checked })}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <PersonalisationEditor productId={productId} addons={data.addons} currency={currency} onChange={refresh} />
    </div>
  )
}

// Click the text to rename it in place. Enter or blur saves, Escape cancels, and
// a rejected save (duplicate name) keeps the field open with the draft intact so
// the admin can correct it rather than retype it.
function InlineRename({ value, onSave, disabled, ariaLabel, inputWidth, textStyle }: {
  value: string
  onSave: (next: string) => Promise<boolean>
  disabled: boolean
  ariaLabel: string
  inputWidth: number
  textStyle?: CSSProperties
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  async function commit() {
    const next = draft.trim()
    if (!next || next === value) { setEditing(false); return }
    setSaving(true)
    const ok = await onSave(next)
    setSaving(false)
    if (ok) setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={ariaLabel}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        style={{ padding: '0.125rem 0.375rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', width: inputWidth, fontSize: '0.8125rem', background: 'var(--color-surface)', color: 'var(--color-text)' }}
      />
    )
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => { setDraft(value); setEditing(true) }}
      style={{ background: 'none', border: 'none', borderBottom: '1px dashed var(--color-border)', padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--color-text)', ...textStyle }}
    >
      {value}
    </button>
  )
}

function AddValueInline({ optionId, isSwatch, onAdd, disabled }: {
  optionId: string
  isSwatch: boolean
  onAdd: (optionId: string, label: string, swatch: string | null) => void
  disabled: boolean
}) {
  const [label, setLabel] = useState('')
  const [swatch, setSwatch] = useState('#000000')
  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
      <input
        placeholder="Add value" value={label} onChange={(e) => setLabel(e.target.value)}
        aria-label="New option value"
        onKeyDown={(e) => { if (e.key === 'Enter') { onAdd(optionId, label, isSwatch ? swatch : null); setLabel('') } }}
        style={{ padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', width: 110, fontSize: '0.8125rem', background: 'var(--color-bg)', color: 'var(--color-text)' }}
      />
      {isSwatch && <input type="color" aria-label="Swatch colour" value={swatch} onChange={(e) => setSwatch(e.target.value)} style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }} />}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onAdd(optionId, label, isSwatch ? swatch : null); setLabel('') }} disabled={disabled || !label.trim()}>+</button>
    </span>
  )
}

function BulkControls({ currency, onSetPrice, onSetStock, disabled }: {
  currency: string
  onSetPrice: (v: number) => void
  onSetStock: (v: number) => void
  disabled: boolean
}) {
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')
  const small: CSSProperties = { padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', width: 80, fontSize: '0.8125rem', background: 'var(--color-bg)', color: 'var(--color-text)' }
  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8125rem' }}>
      <span style={{ color: 'var(--color-text-muted)' }}>Fill every row:</span>
      <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
        {currency}<input type="number" min={0} step="0.01" placeholder="price" aria-label="Price for every variant" value={price} onChange={(e) => setPrice(e.target.value)} style={small} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || price === ''} onClick={() => onSetPrice(Number(price))}>Apply</button>
      </span>
      <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
        <input type="number" step="1" placeholder="stock" aria-label="Stock for every variant" value={stock} onChange={(e) => setStock(e.target.value)} style={small} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || stock === ''} onClick={() => onSetStock(Number(stock))}>Apply</button>
      </span>
    </div>
  )
}

// Picks from the same shared media library (with upload) as the main product
// gallery, rather than asking the admin to paste a URL. A variant only ever has
// one image, so the first of a multi-select wins.
function ImageCell({ url, onSet }: { url: string | null; onSet: (url: string | null) => void }) {
  const [picking, setPicking] = useState(false)
  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => setPicking(true)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
        aria-label={url ? 'Change variant image' : 'Add variant image'}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader
          <img src={url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }} />
        ) : (
          <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>＋</span>
        )}
      </button>
      {url && (
        <button type="button" onClick={() => onSet(null)} aria-label="Remove variant image" className="spe-icon-btn spe-icon-btn-danger">×</button>
      )}
      {picking && (
        <MediaPickerModal
          onClose={() => setPicking(false)}
          onAdd={(items) => {
            const first = items[0]
            if (first) onSet(first.url)
            setPicking(false)
          }}
        />
      )}
    </span>
  )
}
