'use client'

import { useCallback, useEffect, useMemo, useState, type ComponentType, type CSSProperties, type DragEvent } from 'react'
import { MediaPickerModal } from '@/modules/shop/components/admin/MediaPickerModal'
import { uploadOneFile } from '@/lib/media/upload-client'
import { preflightUploadError } from '@/lib/media/limits'
import {
  useProductEditorCurrency, useProductEditorSave, useProductEditorTabBadge,
} from '@/modules/shop/components/admin/product-editor/context'
import { PersonalisationEditor } from '@/modules/shop-variations/components/admin/PersonalisationEditor'
import type { SvrAddon, SvrControlType } from '@/modules/shop-variations/lib/types'

type OptionValue = { id: string; label: string; swatch: string | null; position: number }
type Option = { id: string; name: string; controlType: SvrControlType; position: number; requiresPreviousOption: boolean; values: OptionValue[] }
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

/**
 * A column another module has hung on the variants table through the
 * `shop-variations.variant-columns` point, resolved for us by
 * ProductVariationsSection (only a server component can read the manifests).
 *
 * The cell owns its own saving. Nothing here is wired into the editor's Save
 * button, and that is deliberate: the columns this exists for carry uploads, and
 * an upload has either happened or it has not - holding one in memory as a
 * pending edit would be a lie that costs the admin their file.
 */
export type VariantColumn = {
  id: string
  label: string
  Cell: ComponentType<{ productId: string; variantId: string; childProductId: string; label: string }>
}

const CONTROL_LABELS: Record<Option['controlType'], string> = { DROPDOWN: 'Dropdown', SWATCH: 'Colour swatch', PILL: 'Pills', IMAGE: 'Image swatch' }

const DEFAULT_SWATCH = '#000000'

// Accepts what someone actually pastes out of a brand guide - with or without
// the hash, three digits or six, any case - and returns the one form the swatch
// is stored and rendered in. Anything else is not a colour, so: null.
function normaliseHex(raw: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim())
  if (!match?.[1]) return null
  const body = match[1].toLowerCase()
  return `#${body.length === 3 ? body.replace(/./g, (c) => c + c) : body}`
}

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
export function VariationsPanel({ productId, columns = [] }: { productId: string; columns?: VariantColumn[] }) {
  const currency = useProductEditorCurrency()
  const [data, setData] = useState<Payload | null>(null)
  const [edits, setEdits] = useState<Record<string, VariantEdit>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [optionError, setOptionError] = useState<string | null>(null)
  // A failed load must not leave a blank tab with no way back: once we have data
  // we keep showing it, but before the first successful load a failure shows an
  // error with a Retry rather than rendering nothing.
  const [loadFailed, setLoadFailed] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/m/shop-variations/admin/products/${productId}`)
      if (res.ok) { setData(await res.json()); setLoadFailed(false) }
      else setLoadFailed(true)
    } catch { setLoadFailed(true) }
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

  async function patchAndRefresh(url: string, patch: Record<string, string | boolean | null>, fallback: string): Promise<boolean> {
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

  const renameOption = (id: string, name: string) => patchAndRefresh(`/api/m/shop-variations/admin/options/${id}`, { name }, 'Could not rename that option.')
  const setRequiresPrevious = (id: string, requiresPreviousOption: boolean) => patchAndRefresh(`/api/m/shop-variations/admin/options/${id}`, { requiresPreviousOption }, 'Could not change that setting.')
  const renameValue = (id: string, label: string) => patchAndRefresh(`/api/m/shop-variations/admin/option-values/${id}`, { label }, 'Could not rename that value.')
  const recolourValue = (id: string, swatch: string) => patchAndRefresh(`/api/m/shop-variations/admin/option-values/${id}`, { swatch }, 'Could not change that colour.')
  const repictureValue = (id: string, swatch: string) => patchAndRefresh(`/api/m/shop-variations/admin/option-values/${id}`, { swatch }, 'Could not change that picture.')

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

  // --- Drag to reorder -----------------------------------------------------
  // Options reorder as whole cards; values reorder within their own option, so a
  // value drag is pinned to its option id and never crosses into another.
  const [optionDrag, setOptionDrag] = useState<number | null>(null)
  const [optionOver, setOptionOver] = useState<number | null>(null)
  const [valueDrag, setValueDrag] = useState<{ optionId: string; index: number } | null>(null)
  const [valueOver, setValueOver] = useState<{ optionId: string; index: number } | null>(null)

  // Write back only the rows whose position actually moved. The editor grid and
  // the storefront both read options and values in "position" order, so a refresh
  // straightens the display out; a rejected write falls back to the server truth.
  async function persistPositions(url: (id: string) => string, ordered: { id: string; position: number }[]) {
    setBusy(true)
    const moved = ordered.map((row, index) => ({ row, index })).filter(({ row, index }) => row.position !== index)
    await Promise.all(moved.map(({ row, index }) => fetch(url(row.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: index }),
    })))
    await refresh(); setBusy(false)
  }

  function moveOption(from: number, to: number) {
    if (!data || from === to) return
    const next = [...data.options]
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    setData({ ...data, options: next })
    void persistPositions((id) => `/api/m/shop-variations/admin/options/${id}`, next)
  }

  function moveValue(optionId: string, from: number, to: number) {
    if (!data || from === to) return
    const opt = data.options.find((o) => o.id === optionId)
    if (!opt) return
    const nextValues = [...opt.values]
    const [moved] = nextValues.splice(from, 1)
    if (!moved) return
    nextValues.splice(to, 0, moved)
    setData({ ...data, options: data.options.map((o) => (o.id === optionId ? { ...o, values: nextValues } : o)) })
    void persistPositions((id) => `/api/m/shop-variations/admin/option-values/${id}`, nextValues)
  }

  // --- Matrix --------------------------------------------------------------
  // A big matrix is built a batch at a time on the server (each variant is a real
  // hidden product, so hundreds cannot be made inside one request). We keep asking
  // for the next batch until the server says it is done, refreshing between each so
  // the count climbs in view. One press builds the lot; closing the tab part-way
  // just leaves a resumable gap the next press fills.
  async function generate() {
    setBusy(true); setMessage(null)
    try {
      while (true) {
        const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/generate-matrix`, { method: 'POST' })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) { setMessage(body.error ?? 'Could not work out the variants.'); break }
        await refresh()
        if (body.done) {
          setMessage(`${body.total} variant${body.total === 1 ? '' : 's'} now.`)
          break
        }
        // No progress and not done should not happen, but guard against spinning.
        if (!body.created && !body.removed) { setMessage('The variant build stalled - please try again.'); break }
        setMessage(`Building variants… ${body.total} so far.`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function clearAll() {
    if (!window.confirm('Delete every variant for this product? Their stock counts and prices go with them.')) return
    setBusy(true)
    await fetch(`/api/m/shop-variations/admin/products/${productId}/clear-variants`, { method: 'POST' })
    setEdits({})
    await refresh(); setBusy(false)
  }

  // Remove one variant. Generating hundreds at once leaves rows you never sell,
  // and rebuilding would only make them again - so each is deletable on its own.
  // Any unsaved edit to that row is dropped along with it.
  async function removeVariant(variantId: string) {
    if (!window.confirm('Delete this variant? Its stock count and price go with it.')) return
    setBusy(true)
    await fetch(`/api/m/shop-variations/admin/variants/${variantId}`, { method: 'DELETE' })
    setEdits((prev) => { const next = { ...prev }; delete next[variantId]; return next })
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
  // Fewer rows than the options call for - a big matrix that has not finished
  // building yet. The build is resumable (generateMatrix only fills the gap), so
  // this is a "keep going" state, not a "start over" one.
  const incomplete = data != null && expectedCount > data.variants.length

  if (!data) {
    if (!loadFailed) return null
    return (
      <div className="spe-panel">
        <p className="spe-error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span><span aria-hidden>⚠</span> The variations for this product could not be loaded.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void refresh() }}>Try again</button>
        </p>
      </div>
    )
  }

  const input: CSSProperties = { padding: '0.375rem 0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', width: '100%', background: 'var(--color-bg)', color: 'var(--color-text)', font: 'inherit', fontSize: '0.875rem' }
  const numInput: CSSProperties = { ...input, width: 90 }
  // The first column stays put while the rest of the grid scrolls sideways, so
  // you never lose track of which variant a row is. It needs a solid background
  // (the section's own) so scrolled cells do not show through, and a right border
  // to mark where the frozen column ends. Body cells override the background per
  // row so an edited row's amber tint carries across.
  const stickyCol: CSSProperties = { padding: '0.5rem', whiteSpace: 'nowrap', position: 'sticky', left: 0, zIndex: 1, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }
  const stickyColHead: CSSProperties = { ...stickyCol, zIndex: 2 }

  return (
    <div className="spe-panel">
      <section className="spe-section">
        <h3 className="spe-section-head">Options</h3>
        <p className="spe-section-blurb">
          The choices a shopper makes before buying, like Size or Colour. Add the options first, then generate the
          combinations underneath. Drag the handles to put the options, and the values inside them, in the order shoppers
          should see.
        </p>

        {optionError && <p className="spe-error" role="alert"><span aria-hidden>⚠</span>{optionError}</p>}

        {data.options.length === 0 ? (
          <p className="spe-empty">No options yet. Add one below and this product stays a plain single item.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {data.options.map((opt, oi) => (
              <div
                key={opt.id}
                onDragOver={(e) => { if (optionDrag !== null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOptionOver(oi) } }}
                onDrop={(e) => { if (optionDrag !== null) { e.preventDefault(); moveOption(optionDrag, oi); setOptionDrag(null); setOptionOver(null) } }}
                style={{
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem',
                  opacity: optionDrag === oi ? 0.5 : 1,
                  outline: optionOver === oi && optionDrag !== null && optionDrag !== oi ? '2px solid var(--color-primary)' : undefined,
                  outlineOffset: 2,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
                    {data.options.length > 1 && (
                      <DragGrip
                        label={`Drag to reorder option ${opt.name}`}
                        disabled={busy}
                        onDragStart={(e) => { setOptionDrag(oi); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', opt.id) } catch { /* Firefox refuses to start a drag without a payload */ } }}
                        onDragEnd={() => { setOptionDrag(null); setOptionOver(null) }}
                      />
                    )}
                    <InlineRename value={opt.name} ariaLabel={`Rename option ${opt.name}`} onSave={(name) => renameOption(opt.id, name)} disabled={busy} inputWidth={160} textStyle={{ fontWeight: 600 }} />
                  </span>
                  <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{CONTROL_LABELS[opt.controlType]}</span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => deleteOption(opt.id)} disabled={busy}>Remove</button>
                  </span>
                </div>
                {/* Only the second option onward can wait on the one before it; the
                    first has nothing above it to wait for. */}
                {oi > 0 && (
                  <label style={{ display: 'inline-flex', gap: '0.375rem', alignItems: 'center', marginTop: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                    <input
                      type="checkbox"
                      checked={opt.requiresPreviousOption}
                      disabled={busy}
                      onChange={(e) => setRequiresPrevious(opt.id, e.target.checked)}
                    />
                    Only show once “{data.options[oi - 1]?.name}” is chosen
                  </label>
                )}
                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginTop: '0.5rem', alignItems: 'center' }}>
                  {opt.values.map((v, vi) => (
                    <span
                      key={v.id}
                      onDragOver={(e) => { if (valueDrag?.optionId === opt.id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setValueOver({ optionId: opt.id, index: vi }) } }}
                      onDrop={(e) => { if (valueDrag?.optionId === opt.id) { e.preventDefault(); moveValue(opt.id, valueDrag.index, vi); setValueDrag(null); setValueOver(null) } }}
                      style={{
                        display: 'inline-flex', gap: '0.25rem', alignItems: 'center', background: 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', padding: '0.125rem 0.5rem', fontSize: '0.8125rem',
                        opacity: valueDrag?.optionId === opt.id && valueDrag.index === vi ? 0.5 : 1,
                        outline: valueOver?.optionId === opt.id && valueOver.index === vi && valueDrag?.optionId === opt.id && valueDrag.index !== vi ? '2px solid var(--color-primary)' : undefined,
                        outlineOffset: 1,
                      }}
                    >
                      {opt.values.length > 1 && (
                        <DragGrip
                          label={`Drag to reorder ${v.label}`}
                          disabled={busy}
                          onDragStart={(e) => { setValueDrag({ optionId: opt.id, index: vi }); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', v.id) } catch { /* Firefox refuses to start a drag without a payload */ } }}
                          onDragEnd={() => { setValueDrag(null); setValueOver(null) }}
                        />
                      )}
                      {opt.controlType === 'SWATCH' && (
                        <InlineSwatch value={v.swatch} label={v.label} onSave={(swatch) => recolourValue(v.id, swatch)} disabled={busy} />
                      )}
                      {opt.controlType === 'IMAGE' && (
                        <InlineImageSwatch value={v.swatch} label={v.label} onSave={(swatch) => repictureValue(v.id, swatch)} disabled={busy} />
                      )}
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
              <option value="IMAGE">Image swatch</option>
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
              {data.variants.length === 0
                ? 'Generate variants'
                : incomplete ? 'Continue building options' : 'Rebuild from options'}
            </button>
            {data.variants.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={clearAll} disabled={busy}>Delete all</button>}
          </div>
        </div>

        {matrixStale && data.variants.length > 0 && (
          <div className="alert alert-warning" role="status" style={{ marginBottom: '0.75rem' }}>
            {incomplete ? (
              <>
                Your options make {expectedCount} combinations but only {data.variants.length} {data.variants.length === 1 ? 'is' : 'are'} built so far.
                Large sets build a batch at a time, so keep pressing “Continue building options” until the two numbers meet.
              </>
            ) : (
              <>
                Your options make {expectedCount} combination{expectedCount === 1 ? '' : 's'} but there {data.variants.length === 1 ? 'is' : 'are'} {data.variants.length} here.
                Rebuild from options to line them back up.
              </>
            )}
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
                    <th style={stickyColHead}>Variant</th>
                    <th style={{ padding: '0.5rem' }}>Image</th>
                    {columns.map((c) => <th key={c.id} style={{ padding: '0.5rem' }}>{c.label}</th>)}
                    <th style={{ padding: '0.5rem' }}>Price</th>
                    <th style={{ padding: '0.5rem' }}>SKU</th>
                    <th style={{ padding: '0.5rem' }}>Stock</th>
                    <th style={{ padding: '0.5rem' }}>Weight</th>
                    <th style={{ padding: '0.5rem' }}>On sale</th>
                    <th style={{ padding: '0.5rem' }} aria-label="Delete" />
                  </tr>
                </thead>
                <tbody>
                  {data.variants.map((v) => {
                    const enabled = valueOf(v, 'enabled')
                    const changed = edits[v.variantId] != null
                    return (
                      <tr key={v.variantId} style={{ borderBottom: '1px solid var(--color-border)', opacity: enabled ? 1 : 0.55, background: changed ? 'var(--color-warning-subtle)' : undefined }}>
                        <td style={{ ...stickyCol, background: changed ? 'var(--color-warning-subtle)' : 'var(--color-surface)' }}>{v.label || '—'}</td>
                        <td style={{ padding: '0.5rem' }}>
                          <ImageCell url={valueOf(v, 'imageUrl')} onSet={(url) => editVariant(v.variantId, { imageUrl: url })} />
                        </td>
                        {columns.map(({ id, Cell }) => (
                          <td key={id} style={{ padding: '0.5rem' }}>
                            <Cell productId={productId} variantId={v.variantId} childProductId={v.childProductId} label={v.label} />
                          </td>
                        ))}
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
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                          <button
                            type="button" className="btn btn-secondary btn-sm"
                            aria-label={`Delete variant ${v.label}`}
                            onClick={() => removeVariant(v.variantId)} disabled={busy}
                          >
                            Delete
                          </button>
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

// The grab handle on an option card or a value pill. Only the handle is
// draggable, so the inline rename, swatch and delete controls beside it keep
// their ordinary click and text-select behaviour. Mouse-only, matching the
// variant-image drop target above; the choices still read top-to-bottom for
// anyone not using a pointer.
function DragGrip({ label, disabled, onDragStart, onDragEnd }: {
  label: string
  disabled: boolean
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
}) {
  return (
    <span
      aria-label={label}
      title="Drag to reorder"
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        cursor: disabled ? 'default' : 'grab',
        color: 'var(--color-text-muted)',
        fontSize: '0.875rem',
        lineHeight: 1,
        userSelect: 'none',
        flexShrink: 0,
        touchAction: 'none',
      }}
    >
      ⠿
    </span>
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

// The colour picker and its hex box are two views of one draft string, never two
// states kept in step. The draft is whatever was typed, so a half-finished "#ff0"
// stays as typed instead of being expanded to "#ffff00" under the cursor; the
// picker just reads the nearest valid colour out of it.
function SwatchFields({ value, onChange, disabled, labelPrefix, autoFocus }: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  labelPrefix: string
  autoFocus?: boolean
}) {
  const hex = normaliseHex(value)
  return (
    <>
      <input
        type="color" aria-label={`${labelPrefix} colour picker`} disabled={disabled}
        value={hex ?? DEFAULT_SWATCH}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'none', flexShrink: 0 }}
      />
      <input
        autoFocus={autoFocus} spellCheck={false} placeholder={DEFAULT_SWATCH} disabled={disabled}
        aria-label={`${labelPrefix} hex code`} aria-invalid={hex ? undefined : true}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: '0.25rem 0.375rem', borderRadius: 'var(--radius-md)', border: `1px solid ${hex ? 'var(--color-border)' : 'var(--color-destructive)'}`, width: 82, fontSize: '0.8125rem', fontFamily: 'monospace', background: 'var(--color-bg)', color: 'var(--color-text)' }}
      />
    </>
  )
}

// The colour behind a swatch value, changeable after the fact. Click the dot to
// open the picker and the hex box; brand colours turn up written down far more
// often than they turn up as a point on a colour wheel, so both ways in matter.
// Saving is on the tick or Enter rather than on blur, because moving between the
// picker and the hex box is a blur and would otherwise save half an edit.
function InlineSwatch({ value, label, onSave, disabled }: {
  value: string | null
  label: string
  onSave: (next: string) => Promise<boolean>
  disabled: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? DEFAULT_SWATCH)
  const [saving, setSaving] = useState(false)
  const hex = normaliseHex(draft)

  async function commit() {
    if (!hex) return
    if (hex === value) { setEditing(false); return }
    setSaving(true)
    const ok = await onSave(hex)
    setSaving(false)
    if (ok) setEditing(false)
  }

  if (editing) {
    return (
      <span
        style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit() }
          if (e.key === 'Escape') { setDraft(value ?? DEFAULT_SWATCH); setEditing(false) }
        }}
      >
        <SwatchFields value={draft} onChange={setDraft} disabled={saving} labelPrefix={`${label} swatch`} autoFocus />
        <button type="button" className="spe-icon-btn" aria-label={`Save the colour for ${label}`} disabled={saving || !hex} onClick={() => void commit()}>✓</button>
      </span>
    )
  }

  return (
    <button
      type="button"
      aria-label={value ? `Change the colour for ${label}` : `Set a colour for ${label}`}
      disabled={disabled}
      onClick={() => { setDraft(value ?? DEFAULT_SWATCH); setEditing(true) }}
      style={{ width: 14, height: 14, padding: 0, flexShrink: 0, borderRadius: 'var(--radius-full)', cursor: 'pointer', background: value ?? 'transparent', border: value ? '1px solid var(--color-border)' : '1px dashed var(--color-text-muted)' }}
    />
  )
}

// The picture behind an image-swatch value: the same job as InlineSwatch, in a
// different medium. Clicking the thumbnail opens the shared media library, which
// carries its own upload button, so a picture nobody has uploaded yet and one
// that is already filed are the same two clicks apart.
//
// There is no hand-typed equivalent of the hex box here, and so no draft to
// hold: the library hands back a url or the admin cancels. Saving therefore
// happens on the pick itself rather than behind a tick.
//
// A value with no picture shows a dotted square, matching the dotted dot an
// uncoloured swatch shows, and the storefront falls back to the bare label.
function InlineImageSwatch({ value, label, onSave, disabled }: {
  value: string | null
  label: string
  onSave: (next: string) => Promise<boolean>
  disabled: boolean
}) {
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(url: string) {
    setPicking(false)
    if (url === value) return
    setSaving(true)
    await onSave(url)
    setSaving(false)
  }

  // A picture dropped straight onto the box is the library pick by a shorter
  // route: upload it, then file the value at the row it created. Reordering drags
  // carry no files, so isFileDrag keeps those from lighting the box up.
  async function receiveDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    // Same rules the library itself applies, checked here so a wrong file type or
    // an oversized photo says so at once instead of after the round trip.
    const reason = preflightUploadError(file)
    if (reason) { setError(reason); return }
    setError(null)
    setSaving(true)
    try {
      const media = await uploadOneFile(file, null)
      await onSave(media.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image would not upload.')
    } finally {
      setSaving(false)
    }
  }

  const busy = disabled || saving
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
      <button
        type="button"
        aria-label={value ? `Change the picture for ${label}, or drop an image here` : `Set a picture for ${label}, or drop an image here`}
        title="Click to choose from the library, or drop an image here"
        disabled={busy}
        onClick={() => setPicking(true)}
        onDragEnter={(e) => { if (!busy && isFileDrag(e)) { e.preventDefault(); setDragOver(true) } }}
        onDragOver={(e) => { if (!busy && isFileDrag(e)) { e.preventDefault(); setDragOver(true) } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { if (!busy && isFileDrag(e)) void receiveDrop(e) }}
        style={{
          width: 22, height: 22, padding: 0, flexShrink: 0, overflow: 'hidden',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'var(--radius-md)',
          background: dragOver ? 'var(--color-primary-subtle)' : 'none',
          cursor: busy ? 'progress' : 'pointer',
          border: dragOver
            ? '2px solid var(--color-primary)'
            : value ? '1px solid var(--color-border)' : '1px dashed var(--color-text-muted)',
        }}
      >
        {saving ? (
          <span aria-hidden style={{ fontSize: '0.625rem', lineHeight: 1, color: 'var(--color-text-muted)' }}>…</span>
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader
          <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <span aria-hidden style={{ fontSize: '0.625rem', lineHeight: 1, color: dragOver ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>＋</span>
        )}
      </button>
      {error && (
        <span role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.6875rem', maxWidth: 160, lineHeight: 1.3 }}>{error}</span>
      )}
      {picking && (
        <MediaPickerModal
          onClose={() => setPicking(false)}
          onAdd={(items) => {
            // One value, one picture: the library picks in multiples, so the
            // first of a multi-select wins - as it does for the variant images
            // in the grid below.
            const first = items[0]
            if (first) void choose(first.url)
            else setPicking(false)
          }}
        />
      )}
    </span>
  )
}

function AddValueInline({ optionId, isSwatch, onAdd, disabled }: {
  optionId: string
  isSwatch: boolean
  onAdd: (optionId: string, label: string, swatch: string | null) => void
  disabled: boolean
}) {
  const [label, setLabel] = useState('')
  const [swatch, setSwatch] = useState(DEFAULT_SWATCH)
  const hex = normaliseHex(swatch)
  const canAdd = !disabled && label.trim() !== '' && (!isSwatch || hex != null)

  function add() {
    if (!canAdd) return
    onAdd(optionId, label, isSwatch ? hex : null)
    setLabel('')
  }

  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
      <input
        placeholder="Add value" value={label} onChange={(e) => setLabel(e.target.value)}
        aria-label="New option value"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        style={{ padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', width: 110, fontSize: '0.8125rem', background: 'var(--color-bg)', color: 'var(--color-text)' }}
      />
      {isSwatch && (
        <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}>
          <SwatchFields value={swatch} onChange={setSwatch} labelPrefix="New value" />
        </span>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={add} disabled={!canAdd}>+</button>
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

// A drag carrying files reports 'Files' among its types. The product editor also
// drags its own gallery images about for reordering, and those must not light
// this box up as a drop target - they carry no files.
function isFileDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types ?? []).includes('Files')
}

// Picks from the same shared media library (with upload) as the main product
// gallery, rather than asking the admin to paste a URL. A variant only ever has
// one image, so the first of a multi-select wins - and a dropped file is the
// same thing by a shorter route: upload it, then point the variant at the row it
// created. Dropping onto a variant that already has an image replaces it.
function ImageCell({ url, onSet }: { url: string | null; onSet: (url: string | null) => void }) {
  const [picking, setPicking] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function receiveDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    // Same rules the library itself applies, checked here so a wrong file type or
    // an oversized photo says so at once instead of after the round trip.
    const reason = preflightUploadError(file)
    if (reason) { setError(reason); return }
    setError(null)
    setUploading(true)
    try {
      const media = await uploadOneFile(file, null)
      onSet(media.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image would not upload.')
    } finally {
      setUploading(false)
    }
  }

  const boxBase: CSSProperties = {
    width: 36, height: 36, borderRadius: 'var(--radius-md)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }

  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'flex-start' }}>
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.25rem' }}>
        <button
          type="button"
          onClick={() => setPicking(true)}
          onDragEnter={(e) => { if (isFileDrag(e)) { e.preventDefault(); setDragOver(true) } }}
          onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); setDragOver(true) } }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { if (isFileDrag(e)) void receiveDrop(e) }}
          disabled={uploading}
          style={{
            background: dragOver ? 'var(--color-primary-subtle)' : 'none',
            border: 'none', padding: 0, display: 'inline-flex',
            borderRadius: 'var(--radius-md)',
            cursor: uploading ? 'progress' : 'pointer',
          }}
          aria-label={url ? 'Change variant image, or drop an image here' : 'Add variant image, or drop an image here'}
          title="Click to choose from the library, or drop an image here"
        >
          {uploading ? (
            <span style={{ ...boxBase, border: '1px dashed var(--color-primary)', color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>…</span>
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader
            <img src={url} alt="" style={{ ...boxBase, objectFit: 'cover', border: dragOver ? '2px solid var(--color-primary)' : '1px solid var(--color-border)' }} />
          ) : (
            <span style={{ ...boxBase, border: dragOver ? '2px solid var(--color-primary)' : '1px dashed var(--color-border)', color: dragOver ? 'var(--color-primary)' : 'var(--color-text-muted)', fontSize: '0.75rem' }}>＋</span>
          )}
        </button>
        {error && (
          <span role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.6875rem', maxWidth: 180, lineHeight: 1.3 }}>{error}</span>
        )}
      </span>
      {url && !uploading && (
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
