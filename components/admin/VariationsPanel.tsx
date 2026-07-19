'use client'

import { useCallback, useEffect, useMemo, useState, type ComponentType, type CSSProperties, type DragEvent } from 'react'
import { MediaPickerModal } from '@/modules/shop/components/admin/MediaPickerModal'
import { useAlert, usePrompt } from '@/modules/shop/components/admin/dialogs'
import { uploadOneFile } from '@/lib/media/upload-client'
import { preflightUploadError } from '@/lib/media/limits'
import {
  useProductEditorCurrency, useProductEditorSave, useProductEditorTabBadge,
} from '@/modules/shop/components/admin/product-editor/context'
import { PersonalisationEditor } from '@/modules/shop-variations/components/admin/PersonalisationEditor'
import {
  OptionSourcePicker, type OptionSourceSelection, type PickerProvider,
} from '@/modules/shop-variations/components/admin/OptionSourcePicker'
import type { SvrAddon, SvrControlType } from '@/modules/shop-variations/lib/types'

type OptionValue = { id: string; label: string; swatch: string | null; position: number; sourceRef: string | null }
type Option = {
  id: string; name: string; controlType: SvrControlType; position: number; requiresPreviousOption: boolean
  // Set when the option was built from another module's source. Null on a
  // hand-typed option.
  sourceProvider: string | null; sourceRef: string | null
  values: OptionValue[]
}
type VariantRow = {
  variantId: string; childProductId: string; optionValueIds: string[]; label: string
  enabled: boolean; price: number; sku: string | null; barcode: string | null; supplier: string | null
  salePrice: number | null; retailPrice: number | null; tradePrice: number | null; costPrice: number | null
  trackInventory: boolean; stockCount: number | null; weight: number | null; imageUrls: string[]
}
type Payload = {
  product: { id: string; name: string; price: number }
  options: Option[]
  variants: VariantRow[]
  addons: SvrAddon[]
}

type VariantEdit = Partial<Pick<
  VariantRow,
  'price' | 'salePrice' | 'retailPrice' | 'tradePrice' | 'costPrice' | 'sku' | 'supplier' | 'stockCount' | 'weight' | 'enabled' | 'imageUrls'
>>

/**
 * The optional price types a shop can switch on under Shop settings, and the
 * variant field each one edits. The Variations grid offers a column per switched
 * -on type, so a variant carries the same set of figures as an ordinary product
 * rather than only the one price it used to.
 *
 * The labels are deliberately shorter than the product editor's ("Sale" rather
 * than "Sale price") - these are column headings on a table that already has
 * five other columns, and the full names push the grid off the side of a laptop.
 */
const OPTIONAL_PRICE_FIELDS = [
  { type: 'sale', field: 'salePrice', label: 'Sale' },
  { type: 'retail', field: 'retailPrice', label: 'RRP' },
  { type: 'trade', field: 'tradePrice', label: 'Trade' },
  { type: 'cost', field: 'costPrice', label: 'Cost' },
] as const satisfies ReadonlyArray<{ type: string; field: keyof VariantEdit; label: string }>

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
  /**
   * Set for a dynamic field-provider column: the opaque key that tells the
   * provider's single Cell which of its columns this is. Absent for a static
   * variant-column, whose Cell is the whole column and needs no key.
   */
  columnKey?: string
  Cell: ComponentType<{ productId: string; variantId: string; childProductId: string; label: string; columnKey?: string }>
}

const CONTROL_LABELS: Record<Option['controlType'], string> = { DROPDOWN: 'Dropdown', SWATCH: 'Colour swatch', PILL: 'Pills', IMAGE: 'Image swatch' }
// One order for both the add-an-option box and the per-option picker, so the list
// never reads differently depending on where the owner meets it.
const CONTROL_ORDER: Option['controlType'][] = ['DROPDOWN', 'PILL', 'SWATCH', 'IMAGE']

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
export function VariationsPanel({ productId, columns = [], enabledPriceTypes = [], weightBasedShippingEnabled = true, supplierField = null }: {
  productId: string
  columns?: VariantColumn[]
  /** Which optional price types this shop has switched on, from Shop settings. */
  enabledPriceTypes?: readonly string[]
  /** Whether the shop prices postage by weight, from Tax & shipping. Off drops
   * the weight column; per-variant weights already saved are left untouched. */
  weightBasedShippingEnabled?: boolean
  /** Set when the shop records a supplier and has asked for the field on
   * variations as well as products, carrying whatever the shop calls it. Null
   * drops the column; suppliers already saved against a variation are left
   * untouched, so switching it back on gets them back. */
  supplierField?: { label: string } | null
}) {
  const currency = useProductEditorCurrency()
  const [promptText, promptNode] = usePrompt()
  const [showAlert, alertNode] = useAlert()
  // Enabled names from the shop's supplier directory. Only fetched when the
  // supplier column is on, so a shop that never asked for it pays nothing.
  const [supplierOptions, setSupplierOptions] = useState<string[]>([])
  const priceFields = useMemo(
    () => OPTIONAL_PRICE_FIELDS.filter((p) => enabledPriceTypes.includes(p.type)),
    [enabledPriceTypes],
  )
  const [data, setData] = useState<Payload | null>(null)
  const [edits, setEdits] = useState<Record<string, VariantEdit>>({})
  // Variant ids ticked for a bulk delete. Pruned to what still exists whenever
  // the grid reloads (see the effect below), so a delete or rebuild can't leave
  // a phantom id selected.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
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

  // Drop any ticked id that no longer has a row - a deleted, rebuilt or cleared
  // variant must not stay selected. The functional update returns the same set
  // when nothing changed, so this can't loop.
  useEffect(() => {
    if (!data) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciling the selection with reloaded data; returns the identical set (no re-render) unless a stale id was actually pruned
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const live = new Set(data.variants.map((v) => v.variantId))
      const next = new Set<string>()
      for (const id of prev) if (live.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [data])

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

  // Where a freshly uploaded variation or swatch image is filed: the product's
  // own library folder (Shop / <category> / <product>), resolved at the moment
  // of upload so the picture lands there straight away instead of in the library
  // root and waiting on the save to move it - the same up-front filing the main
  // product gallery does. A picture that only ever reaches the root depends
  // entirely on the save-time re-file, and if that one move hiccups the picture
  // is stranded in the root with nothing to retry it. Null on failure, in which
  // case the upload still works and falls back to the root as it always did.
  const resolveUploadFolderId = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`/api/m/shop/admin/products/${productId}/media-folder`, { method: 'POST' })
      if (!res.ok) return null
      return (await res.json()).folderId ?? null
    } catch {
      return null
    }
  }, [productId])

  // Where the picker OPENS: same folder, but looked up rather than created
  // (GET vs POST) so a browse-and-cancel leaves no empty folder behind. Falls
  // back to the deepest ancestor that exists, or the root on any failure.
  const resolveBrowseFolderId = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`/api/m/shop/admin/products/${productId}/media-folder`)
      if (!res.ok) return null
      return (await res.json()).folderId ?? null
    } catch {
      return null
    }
  }, [productId])

  // --- Options -------------------------------------------------------------
  // Modules offering ready-made options (attributes, say). Fetched once, and the
  // only way in: options are built from a source list rather than typed here, so
  // every option on every product traces back to one attribute and the same
  // colour cannot exist under three spellings across three products. An empty
  // list (or a failed fetch) therefore leaves no way to add an option, and says
  // so rather than showing a button that would not work.
  const [sourceProviders, setSourceProviders] = useState<PickerProvider[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/m/shop-variations/admin/option-sources')
      .then((res) => (res.ok ? res.json() : { providers: [] }))
      .then((json) => { if (!cancelled) setSourceProviders(json.providers ?? []) })
      .catch(() => { /* no sources on offer; the button simply stays hidden */ })
    return () => { cancelled = true }
  }, [])

  const sourceButtonLabel = sourceProviders.length === 1 && sourceProviders[0]
    ? `Add from ${sourceProviders[0].label.toLowerCase()}`
    : 'Add from a source'

  // What an option was built from, resolved for display. An option stores only
  // its provider id and an opaque ref, so the readable name has to come from the
  // fetched provider list - which is already loaded for the picker, so this costs
  // no extra request.
  //
  // Worth showing because the option's own name need not match the source's: one
  // attribute can be added to a product twice under names of its own ("Seat
  // colour", "Back colour"), and without this the shared origin is invisible.
  //
  // Three outcomes, deliberately distinct:
  //   provider missing -> null, and nothing is rendered. The module is gone or
  //     the user may not use it; naming a source we cannot verify would be a guess.
  //   provider found, ref not -> the source itself has been deleted. Said out
  //     loud, because otherwise the only way to find out is to press Refresh.
  //   both found -> the source is named.
  function describeSource(opt: Option): { providerLabel: string; sourceName: string | null; groupLabel: string | null } | null {
    if (!opt.sourceProvider || !opt.sourceRef) return null
    const provider = sourceProviders.find((p) => p.id === opt.sourceProvider)
    if (!provider) return null
    const source = provider.sources.find((s) => s.ref === opt.sourceRef)
    return { providerLabel: provider.label, sourceName: source?.name ?? null, groupLabel: source?.groupLabel ?? null }
  }

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
  // Values keep whatever colour or picture they were given, so switching a colour
  // swatch to pills and back does not throw the swatches away. Values that have
  // none yet simply show as plain buttons until the owner fills them in, which is
  // the same thing a brand-new swatch option does.
  const setControlType = (id: string, controlType: Option['controlType']) => patchAndRefresh(`/api/m/shop-variations/admin/options/${id}`, { controlType }, 'Could not change how that option is shown.')
  const renameValue = (id: string, label: string) => patchAndRefresh(`/api/m/shop-variations/admin/option-values/${id}`, { label }, 'Could not rename that value.')
  const recolourValue = (id: string, swatch: string) => patchAndRefresh(`/api/m/shop-variations/admin/option-values/${id}`, { swatch }, 'Could not change that colour.')
  const repictureValue = (id: string, swatch: string) => patchAndRefresh(`/api/m/shop-variations/admin/option-values/${id}`, { swatch }, 'Could not change that picture.')

  // Build an option from a source module's ready-made list. Only the picked refs
  // and the (possibly overridden) name travel; the server re-reads the labels and
  // swatches from the source itself.
  async function addOptionFromSource(selection: OptionSourceSelection) {
    setBusy(true); setOptionError(null); setRefreshNote(null)
    const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/options`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: selection.name,
        controlType: selection.controlType,
        source: { provider: selection.provider, ref: selection.ref, valueRefs: selection.valueRefs },
      }),
    })
    if (!res.ok) {
      setBusy(false)
      throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not add that option.')
    }
    setPickerOpen(false)
    await refresh(); setBusy(false)
  }


  async function deleteOption(id: string) {
    setBusy(true)
    await fetch(`/api/m/shop-variations/admin/options/${id}`, { method: 'DELETE' })
    await refresh(); setBusy(false)
  }

  // A value typed here also lands on the list the option came from, so a colour
  // first met on one product is there to pick on the next. That write can be
  // refused (the attribute deleted from under us, the name already taken), and a
  // refusal has to be said out loud - the value is not saved either way.
  async function addValue(optionId: string, label: string, swatch: string | null) {
    if (!label.trim()) return
    setBusy(true); setOptionError(null); setRefreshNote(null)
    const res = await fetch(`/api/m/shop-variations/admin/options/${optionId}/values`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label.trim(), swatch: swatch || null }),
    })
    if (!res.ok) {
      setOptionError((await res.json().catch(() => ({}))).error ?? 'Could not add that value.')
      setBusy(false)
      return
    }
    await refresh(); setBusy(false)
  }

  // Values the option's source offers that it has not taken yet. Computed from
  // the already-fetched provider list, so the picker opens without a round trip.
  // Empty when the option is hand-typed, the module is gone, or the source has
  // nothing left to give - each of which hides the button.
  function unusedSourceValues(opt: Option): { ref: string; label: string; swatch: string | null }[] {
    if (!opt.sourceProvider || !opt.sourceRef) return []
    const source = sourceProviders
      .find((p) => p.id === opt.sourceProvider)
      ?.sources.find((s) => s.ref === opt.sourceRef)
    if (!source) return []
    const taken = new Set(opt.values.map((v) => v.sourceRef).filter(Boolean))
    return source.values.filter((v) => !taken.has(v.ref))
  }

  // Only the refs are sent: the server reads the labels and swatches back from
  // the source itself, so what lands in the database is what the source says.
  async function addValuesFromSource(optionId: string, valueRefs: string[]) {
    setBusy(true); setOptionError(null); setRefreshNote(null)
    const res = await fetch(`/api/m/shop-variations/admin/options/${optionId}/values`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueRefs }),
    })
    if (!res.ok) {
      setOptionError((await res.json().catch(() => ({}))).error ?? 'Could not add those values.')
      setBusy(false)
      return
    }
    // A partial result is worth saying out loud - a value skipped for clashing
    // with a hand-typed one looks like a silent failure otherwise.
    const json = (await res.json().catch(() => ({}))) as { added?: number; skipped?: string[] }
    if (json.skipped?.length) {
      setRefreshNote(`Added ${json.added ?? 0}. Left out ${json.skipped.join(', ')} - this option already has a value by that name.`)
    }
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
    // Variants are numbered into matrix order once, after every moved row has
    // landed. Options and values are what that order is derived from, so leaving
    // this out left the grid showing the old running order until the next
    // regenerate - and hanging it off each PATCH instead would run it once per
    // moved row, with the concurrent calls racing to write the answer.
    if (moved.length > 0) {
      await fetch(`/api/m/shop-variations/admin/products/${productId}/resequence-variants`, { method: 'POST' })
    }
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

  // Tick or untick one variant for the bulk delete.
  function toggleVariant(variantId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(variantId)) next.delete(variantId); else next.add(variantId)
      return next
    })
  }

  // Delete every ticked variant in one request. Unsaved edits to those rows are
  // dropped with them, and the tick list is cleared before the grid reloads.
  async function deleteSelected() {
    const ids = [...selected]
    if (ids.length === 0) return
    if (!window.confirm(`Delete ${ids.length} variant${ids.length === 1 ? '' : 's'}? Their stock counts and prices go with them.`)) return
    setBusy(true)
    await fetch(`/api/m/shop-variations/admin/products/${productId}/delete-variants`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variantIds: ids }),
    })
    setEdits((prev) => { const next = { ...prev }; for (const id of ids) delete next[id]; return next })
    setSelected(new Set())
    await refresh(); setBusy(false)
  }

  // Add one hand-picked combination without building the whole matrix. The server
  // reorders every row afterwards, so the new variant appears in the same place a
  // full generate would have put it. Returns an error string to show inline, or
  // null on success.
  const addSingleVariant = useCallback(async (optionValueIds: string[]): Promise<string | null> => {
    setBusy(true); setMessage(null)
    try {
      const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/variants`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionValueIds }),
      })
      if (!res.ok) return (await res.json().catch(() => ({}))).error ?? 'Could not add that variant.'
      await refresh()
      return null
    } finally {
      setBusy(false)
    }
  }, [productId, refresh])

  // --- Per-variant edits ---------------------------------------------------
  const editVariant = useCallback((variantId: string, patch: VariantEdit) => {
    setEdits((prev) => ({ ...prev, [variantId]: { ...prev[variantId], ...patch } }))
  }, [])

  const valueOf = useCallback(<K extends keyof VariantEdit>(v: VariantRow, key: K): VariantRow[K] => {
    const edited = edits[v.variantId]?.[key]
    return (edited === undefined ? v[key] : edited) as VariantRow[K]
  }, [edits])

  // --- Suppliers -----------------------------------------------------------
  // The directory is the shop's, not this module's, so both the list and the
  // "add a new one" call go to the shop's own endpoint.
  const loadSuppliers = useCallback(async () => {
    try {
      const res = await fetch('/api/m/shop/admin/suppliers?for=picker')
      if (!res.ok) return
      const payload = await res.json()
      if (Array.isArray(payload.suppliers)) setSupplierOptions(payload.suppliers.map((s: { name: string }) => s.name))
    } catch {
      // The column falls back to whatever each variation already has.
    }
  }, [])

  useEffect(() => {
    if (!supplierField) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState runs in an async callback after an await, never synchronously in the effect body
    void loadSuppliers()
  }, [supplierField, loadSuppliers])

  const chooseSupplier = useCallback(async (variantId: string, value: string) => {
    if (value !== ADD_NEW_SUPPLIER) {
      editVariant(variantId, { supplier: value || null })
      return
    }
    const name = (await promptText({ title: `New ${supplierField?.label.toLowerCase() ?? 'supplier'}`, placeholder: 'e.g. Northern Clay Co.', confirmLabel: 'Add' }))?.trim()
    if (!name) return
    const res = await fetch('/api/m/shop/admin/suppliers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      await showAlert((await res.json().catch(() => ({}))).error ?? 'Could not add that supplier.', 'Could not add')
      return
    }
    await loadSuppliers()
    editVariant(variantId, { supplier: name })
  }, [editVariant, loadSuppliers, promptText, showAlert, supplierField])

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

  // Header tick state: fully ticked, or a mix (drawn as the indeterminate dash).
  const allSelected = data.variants.length > 0 && data.variants.every((v) => selected.has(v.variantId))
  const someSelected = selected.size > 0 && !allSelected
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(data.variants.map((v) => v.variantId)))

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
                    {/* How this option is shown to a shopper, changeable after the
                        fact: an owner who set up Size as a dropdown and later
                        wants pills should not have to delete and retype it. */}
                    <select
                      aria-label={`How ${opt.name} is shown`}
                      title="How shoppers pick this option"
                      value={opt.controlType}
                      disabled={busy}
                      onChange={(e) => setControlType(opt.id, e.target.value as Option['controlType'])}
                      style={{ ...input, width: 150, fontSize: '0.8125rem', padding: '0.25rem 0.5rem' }}
                    >
                      {CONTROL_ORDER.map((ct) => (
                        <option key={ct} value={ct}>{CONTROL_LABELS[ct]}</option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => deleteOption(opt.id)} disabled={busy}>Remove</button>
                  </span>
                </div>
                {/* Where the option's values came from. Sits under the name rather
                    than beside it so a long attribute name cannot squeeze the
                    rename field on a narrow screen. */}
                {(() => {
                  const source = describeSource(opt)
                  if (!source) return null
                  return (
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                      {source.sourceName ? (
                        <>
                          From {source.providerLabel.toLowerCase()}:{' '}
                          <span style={{ fontWeight: 600 }}>{source.sourceName}</span>
                          {source.groupLabel ? ` (${source.groupLabel})` : ''}
                        </>
                      ) : (
                        <>Built from {source.providerLabel.toLowerCase()}, but that source no longer exists.</>
                      )}
                    </p>
                  )
                })()}
                {/* Only the second option onward can wait on the ones before it;
                    the first has nothing above it to wait for. When ticked it
                    stays hidden until every option above it has been chosen, not
                    just the one directly before. */}
                {oi > 0 && (
                  <label style={{ display: 'inline-flex', gap: '0.375rem', alignItems: 'center', marginTop: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                    <input
                      type="checkbox"
                      checked={opt.requiresPreviousOption}
                      disabled={busy}
                      onChange={(e) => setRequiresPrevious(opt.id, e.target.checked)}
                    />
                    Only show once every option above it is chosen
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
                        <InlineImageSwatch value={v.swatch} label={v.label} onSave={(swatch) => repictureValue(v.id, swatch)} disabled={busy} resolveUploadFolderId={resolveUploadFolderId} resolveBrowseFolderId={resolveBrowseFolderId} />
                      )}
                      <InlineRename value={v.label} ariaLabel={`Rename value ${v.label}`} onSave={(label) => renameValue(v.id, label)} disabled={busy} inputWidth={90} textStyle={{ fontSize: '0.8125rem' }} />
                      <button type="button" aria-label={`Remove ${v.label}`} onClick={() => deleteValue(v.id)} disabled={busy} className="spe-icon-btn spe-icon-btn-danger">×</button>
                    </span>
                  ))}
                  <AddValueInline optionId={opt.id} isSwatch={opt.controlType === 'SWATCH'} onAdd={addValue} disabled={busy} />
                  {/* Sits beside the type-it-in field rather than replacing it:
                      a sourced option can still take a one-off value of its own. */}
                  <AddFromSourceInline
                    optionId={opt.id}
                    available={unusedSourceValues(opt)}
                    onAdd={addValuesFromSource}
                    disabled={busy}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
          <strong style={{ fontSize: '0.875rem' }}>Add an option</strong>
          {/* One route in, on purpose: options are picked from a list set up once
              elsewhere, so the same colour cannot end up spelled three ways across
              three products. Nothing to pick from means nothing to press, and the
              reason is spelled out rather than left as an empty box. */}
          {sourceProviders.length > 0 ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                Options come from the lists you have already set up:
              </span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setPickerOpen(true)} disabled={busy}>
                {sourceButtonLabel}
              </button>
            </div>
          ) : (
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>
              Options are built from ready-made lists, and nothing is offering any yet. Set up your product attributes
              first, then come back and pick from them here.
            </p>
          )}
        </div>

        {refreshNote && (
          <p style={{ marginTop: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }} role="status">{refreshNote}</p>
        )}

        {pickerOpen && (
          <OptionSourcePicker
            providers={sourceProviders}
            existingOptions={data.options.map((o) => ({ name: o.name, sourceProvider: o.sourceProvider, sourceRef: o.sourceRef }))}
            onCancel={() => setPickerOpen(false)}
            onConfirm={addOptionFromSource}
          />
        )}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <div style={{ minHeight: 30, display: 'flex', alignItems: 'center' }}>
                {selected.size > 0 && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={deleteSelected} disabled={busy}>
                    Delete selected ({selected.size})
                  </button>
                )}
              </div>
              <BulkControls currency={currency} onSetPrice={(v) => bulkSet('price', v)} onSetStock={(v) => bulkSet('stockCount', v)} disabled={busy} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                    <th style={stickyColHead}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          aria-label={allSelected ? 'Clear selection' : 'Select every variant'}
                          checked={allSelected}
                          ref={(el) => { if (el) el.indeterminate = someSelected }}
                          disabled={busy}
                          onChange={toggleAll}
                        />
                        Variant
                      </span>
                    </th>
                    <th style={{ padding: '0.5rem' }}>Image</th>
                    {columns.map((c) => <th key={c.id} style={{ padding: '0.5rem' }}>{c.label}</th>)}
                    <th style={{ padding: '0.5rem' }}>Price</th>
                    {priceFields.map((p) => <th key={p.type} style={{ padding: '0.5rem' }}>{p.label}</th>)}
                    <th style={{ padding: '0.5rem' }}>SKU</th>
                    {supplierField && <th style={{ padding: '0.5rem' }}>{supplierField.label}</th>}
                    <th style={{ padding: '0.5rem' }}>Stock</th>
                    {weightBasedShippingEnabled && <th style={{ padding: '0.5rem' }}>Weight</th>}
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
                        <td style={{ ...stickyCol, background: changed ? 'var(--color-warning-subtle)' : 'var(--color-surface)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${v.label || 'variant'}`}
                              checked={selected.has(v.variantId)}
                              disabled={busy}
                              onChange={() => toggleVariant(v.variantId)}
                            />
                            {v.label || '—'}
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          <ImageCell urls={valueOf(v, 'imageUrls')} onSet={(urls) => editVariant(v.variantId, { imageUrls: urls })} resolveUploadFolderId={resolveUploadFolderId} resolveBrowseFolderId={resolveBrowseFolderId} />
                        </td>
                        {columns.map(({ id, Cell, columnKey }) => (
                          <td key={id} style={{ padding: '0.5rem' }}>
                            <Cell productId={productId} variantId={v.variantId} childProductId={v.childProductId} label={v.label} columnKey={columnKey} />
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
                        {priceFields.map((p) => (
                          <td key={p.type} style={{ padding: '0.5rem' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              {currency}
                              <input
                                type="number" min={0} step="0.01" style={numInput} placeholder="—"
                                aria-label={`${p.label} price for ${v.label}`}
                                value={valueOf(v, p.field) ?? ''}
                                // Emptying the box clears the figure rather than
                                // setting it to zero: a blank sale price means
                                // "not on offer", and a zero one means free.
                                onChange={(e) => editVariant(v.variantId, { [p.field]: e.target.value === '' ? null : Number(e.target.value) })}
                              />
                            </span>
                          </td>
                        ))}
                        <td style={{ padding: '0.5rem' }}>
                          <input
                            style={{ ...input, width: 120 }} placeholder="SKU"
                            aria-label={`SKU for ${v.label}`}
                            value={valueOf(v, 'sku') ?? ''}
                            onChange={(e) => editVariant(v.variantId, { sku: e.target.value || null })}
                          />
                        </td>
                        {supplierField && (
                          <td style={{ padding: '0.5rem' }}>
                            <SupplierCell
                              label={supplierField.label}
                              variantLabel={v.label}
                              value={valueOf(v, 'supplier') ?? ''}
                              options={supplierOptions}
                              onChange={(next) => void chooseSupplier(v.variantId, next)}
                            />
                          </td>
                        )}
                        <td style={{ padding: '0.5rem' }}>
                          <input
                            type="number" step="1" style={numInput} placeholder="—"
                            aria-label={`Stock for ${v.label}`}
                            value={valueOf(v, 'stockCount') ?? ''}
                            onChange={(e) => editVariant(v.variantId, { stockCount: e.target.value === '' ? null : Number(e.target.value) })}
                          />
                        </td>
                        {weightBasedShippingEnabled && (
                          <td style={{ padding: '0.5rem' }}>
                            <input
                              type="number" min={0} step="0.001" style={numInput} placeholder="—"
                              aria-label={`Weight for ${v.label}`}
                              value={valueOf(v, 'weight') ?? ''}
                              onChange={(e) => editVariant(v.variantId, { weight: e.target.value === '' ? null : Number(e.target.value) })}
                            />
                          </td>
                        )}
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

        <AddSingleVariant options={data.options} disabled={busy} onAdd={addSingleVariant} />
      </section>

      <PersonalisationEditor productId={productId} addons={data.addons} currency={currency} onChange={refresh} />
      {promptNode}
      {alertNode}
    </div>
  )
}

// Sentinel option value for "add a new one", picked so it can never collide with
// a real supplier name (those are trimmed before they are saved).
const ADD_NEW_SUPPLIER = ' add-new'

// Matches the grid's own `input` style, which is scoped inside the panel.
const supplierSelectStyle: CSSProperties = {
  padding: '0.375rem 0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
  width: 160, background: 'var(--color-bg)', color: 'var(--color-text)', font: 'inherit', fontSize: '0.875rem',
}

/**
 * The supplier picker in one variation's row. A supplier already saved against
 * the variation but no longer offered - retired from the directory, or typed by
 * hand before the directory existed - is added as an option of its own so
 * opening the grid can never silently blank it.
 */
function SupplierCell({ label, variantLabel, value, options, onChange }: {
  label: string
  variantLabel: string
  value: string
  options: string[]
  onChange: (next: string) => void
}) {
  const orphan = value && !options.includes(value) ? value : null
  return (
    <select
      style={supplierSelectStyle}
      aria-label={`${label} for ${variantLabel}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Not recorded</option>
      {orphan && <option value={orphan}>{orphan}</option>}
      {options.map((name) => <option key={name} value={name}>{name}</option>)}
      <option value={ADD_NEW_SUPPLIER}>Add a new {label.toLowerCase()}…</option>
    </select>
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
function InlineImageSwatch({ value, label, onSave, disabled, resolveUploadFolderId, resolveBrowseFolderId }: {
  value: string | null
  label: string
  onSave: (next: string) => Promise<boolean>
  disabled: boolean
  resolveUploadFolderId: () => Promise<string | null>
  resolveBrowseFolderId: () => Promise<string | null>
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
      const media = await uploadOneFile(file, await resolveUploadFolderId())
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
          resolveInitialFolderId={resolveBrowseFolderId}
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

// Pick more values from the option's own source. Renders nothing when the source
// has none left to offer, which is the common resting state - the button appearing
// is itself the signal that the attribute has grown since this option was built.
//
// A tick list rather than a straight "add them all" because that is what Refresh
// already does. The point here is choosing: a chair sold in four of an attribute's
// twenty-two colours wants four, not twenty-two.
function AddFromSourceInline({ optionId, available, onAdd, disabled }: {
  optionId: string
  available: { ref: string; label: string; swatch: string | null }[]
  onAdd: (optionId: string, valueRefs: string[]) => void | Promise<void>
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [ticked, setTicked] = useState<Set<string>>(new Set())

  if (available.length === 0) return null

  function toggle(ref: string) {
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref); else next.add(ref)
      return next
    })
  }

  function close() { setOpen(false); setTicked(new Set()) }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title="Take more values from the attribute this option came from."
      >
        Add from source ({available.length})
      </button>
    )
  }

  return (
    <div
      style={{
        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
        padding: '0.5rem 0.75rem', display: 'grid', gap: '0.5rem',
        background: 'var(--color-bg)', width: '100%', marginTop: '0.25rem',
      }}
    >
      <strong style={{ fontSize: '0.8125rem' }}>Add from the source</strong>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', maxHeight: 180, overflowY: 'auto' }}>
        {available.map((v) => (
          <label
            key={v.ref}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
              fontSize: '0.8125rem', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', padding: '0.25rem 0.5rem', cursor: 'pointer',
            }}
          >
            <input type="checkbox" checked={ticked.has(v.ref)} onChange={() => toggle(v.ref)} disabled={disabled} />
            {/* Hex swatches show as a dot; picture swatches are urls and would
                not survive being crammed into one, so they stay as labels. */}
            {v.swatch?.startsWith('#') && (
              <span aria-hidden style={{ width: 12, height: 12, borderRadius: 'var(--radius-full)', background: v.swatch, border: '1px solid var(--color-border)' }} />
            )}
            {v.label}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={disabled || ticked.size === 0}
          onClick={async () => { const refs = [...ticked]; close(); await onAdd(optionId, refs) }}
        >
          Add {ticked.size > 0 ? ticked.size : ''}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={close} disabled={disabled}>Cancel</button>
      </div>
    </div>
  )
}

// Build one variant from a hand-picked value per option, rather than generating
// the whole matrix. Only options that actually have values can take part; each
// gets a dropdown defaulting to its first value, so the control is ready to add
// the moment there is something to add. The server owns the real rules (complete
// combination, no duplicate) and its rejection surfaces here inline.
function AddSingleVariant({ options, disabled, onAdd }: {
  options: Option[]
  disabled: boolean
  onAdd: (optionValueIds: string[]) => Promise<string | null>
}) {
  const usable = options.filter((o) => o.values.length > 0)
  const [sel, setSel] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (usable.length === 0) return null

  const valueFor = (o: Option) => sel[o.id] ?? o.values[0]?.id ?? ''

  async function add() {
    const ids = usable.map((o) => valueFor(o)).filter(Boolean)
    if (ids.length !== usable.length) return
    setSaving(true); setError(null)
    const err = await onAdd(ids)
    setSaving(false)
    if (err) setError(err)
  }

  const busy = disabled || saving
  return (
    <div style={{ border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
      <strong style={{ fontSize: '0.875rem' }}>Add a single variant</strong>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>
        Pick one value for each option to add just that combination. It slots into the same place a full generate would put it.
      </p>
      {error && <p className="spe-error" role="alert"><span aria-hidden>⚠</span>{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {usable.map((o) => (
          <label key={o.id} style={{ display: 'grid', gap: '0.25rem', fontSize: '0.8125rem' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>{o.name}</span>
            <select
              value={valueFor(o)}
              disabled={busy}
              onChange={(e) => setSel((prev) => ({ ...prev, [o.id]: e.target.value }))}
              style={{ padding: '0.375rem 0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', font: 'inherit', fontSize: '0.875rem', minWidth: 120 }}
            >
              {o.values.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
        ))}
        <button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={busy}>Add variant</button>
      </div>
    </div>
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
// gallery, rather than asking the admin to paste a URL. A variant can carry a
// whole set of pictures, so every item of a multi-select is kept - and a dropped
// file is the same thing by a shorter route: upload it, then add the row it
// created. The cell has one row's worth of space, so it shows the first image
// with a "+N" badge for the rest rather than trying to draw them all; picking
// again adds to the set, and the × clears the lot.
function ImageCell({ urls, onSet, resolveUploadFolderId, resolveBrowseFolderId }: { urls: string[]; onSet: (urls: string[]) => void; resolveUploadFolderId: () => Promise<string | null>; resolveBrowseFolderId: () => Promise<string | null> }) {
  const [picking, setPicking] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const url = urls[0] ?? null
  const extra = urls.length - 1

  // Adding, not replacing: a set built up over several goes is rather the point
  // of a cell that holds more than one. Duplicates are dropped, so the same
  // library item chosen twice does not appear twice on the storefront strip.
  function addUrls(added: string[]) {
    onSet([...urls, ...added].filter((u, i, arr) => arr.indexOf(u) === i))
  }

  async function receiveDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length === 0) return
    // Same rules the library itself applies, checked here so a wrong file type or
    // an oversized photo says so at once instead of after the round trip.
    const reason = files.map(preflightUploadError).find(Boolean)
    if (reason) { setError(reason); return }
    setError(null)
    setUploading(true)
    try {
      const folderId = await resolveUploadFolderId()
      const uploaded: string[] = []
      for (const file of files) uploaded.push((await uploadOneFile(file, folderId)).url)
      addUrls(uploaded)
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
          aria-label={url ? `Add another variant image (${urls.length} so far), or drop images here` : 'Add variant image, or drop images here'}
          title="Click to choose from the library, or drop images here"
        >
          {uploading ? (
            <span style={{ ...boxBase, border: '1px dashed var(--color-primary)', color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>…</span>
          ) : url ? (
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader */}
              <img src={url} alt="" style={{ ...boxBase, objectFit: 'cover', border: dragOver ? '2px solid var(--color-primary)' : '1px solid var(--color-border)' }} />
              {extra > 0 && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', right: -4, bottom: -4,
                    background: 'var(--color-primary)', color: 'var(--color-on-primary)',
                    borderRadius: 999, padding: '0 0.25rem', minWidth: 16, textAlign: 'center',
                    fontSize: '0.625rem', lineHeight: '16px', fontWeight: 600,
                    border: '1px solid var(--color-surface)',
                  }}
                >+{extra}</span>
              )}
            </span>
          ) : (
            <span style={{ ...boxBase, border: dragOver ? '2px solid var(--color-primary)' : '1px dashed var(--color-border)', color: dragOver ? 'var(--color-primary)' : 'var(--color-text-muted)', fontSize: '0.75rem' }}>＋</span>
          )}
        </button>
        {error && (
          <span role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.6875rem', maxWidth: 180, lineHeight: 1.3 }}>{error}</span>
        )}
      </span>
      {url && !uploading && (
        <button type="button" onClick={() => onSet([])} aria-label={extra > 0 ? `Remove all ${urls.length} variant images` : 'Remove variant image'} title={extra > 0 ? 'Remove all images from this variant' : 'Remove this variant image'} className="spe-icon-btn spe-icon-btn-danger">×</button>
      )}
      {picking && (
        <MediaPickerModal
          resolveInitialFolderId={resolveBrowseFolderId}
          onClose={() => setPicking(false)}
          onAdd={(items) => {
            addUrls(items.map((i) => i.url))
            setPicking(false)
          }}
        />
      )}
    </span>
  )
}
