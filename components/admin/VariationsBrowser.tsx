'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAdminPath } from '@/components/admin/AdminPathContext'
import { formatMoney } from '@/modules/shop/lib/money'
import { isOnSale } from '@/modules/shop/lib/pricing'
import { useCurrencySymbol } from '@/modules/shop/components/admin/use-currency-symbol'
import type { VariationListColumn, VariationListResult, VariationListRow } from '@/modules/shop-variations/lib/variations-list'

// The cross-product Variations browser: the Variations tab on Shop > Products.
// Lists every variation across the catalogue with its image, option-value label,
// price/SKU/stock and any contributed columns (3D file, attributes), and lets the
// owner narrow to one product or to variations missing an image or a 3D file. It
// is a read-only overview: each row links back to its product's Variations tab,
// which is where a variation is actually edited.

const PER_PAGE = 50

// A contributed cell value is a provider's own string - the 3D provider stores a
// pipe-separated list of file urls, an attribute stores a plain label. Show file
// urls by their leaf name (the full url is noise in a table) and labels as-is,
// without this component needing to know which provider produced which.
function fieldDisplay(raw?: string): string {
  if (!raw) return ''
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      // Only shorten things that are actually urls (a file link), never a plain
      // label that merely contains a slash, like "Black / White".
      if (!/:\/\//.test(part) && !part.startsWith('/')) return part
      try {
        const tail = new URL(part, 'https://placeholder.invalid').pathname.split('/').filter(Boolean).pop()
        return tail ? decodeURIComponent(tail) : part
      } catch {
        return part.split('?')[0]?.split('/').filter(Boolean).pop() || part
      }
    })
    .join(', ')
}

// A small searchable dropdown for the product filter - a native <select> cannot be
// typed into, and a catalogue can have a long list of products.
function ProductFilter({ products, value, onChange }: {
  products: Array<{ id: string; name: string }>
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const selected = products.find((p) => p.id === value)
  const q = query.trim().toLowerCase()
  const filtered = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products

  function pick(id: string) { onChange(id); setOpen(false); setQuery('') }

  return (
    <div ref={boxRef} className="svb-combo">
      <button type="button" className="svb-combo-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={selected ? '' : 'svb-muted'}>{selected ? selected.name : 'All products'}</span>
        <span aria-hidden className="svb-combo-caret">▾</span>
      </button>
      {open && (
        <div className="svb-combo-panel" role="listbox">
          <input
            autoFocus
            className="svb-combo-search"
            placeholder="Search products…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search products"
          />
          <div className="svb-combo-list">
            <button type="button" role="option" aria-selected={value === ''} className={`svb-combo-opt${value === '' ? ' is-active' : ''}`} onClick={() => pick('')}>
              All products
            </button>
            {filtered.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected={value === p.id} className={`svb-combo-opt${value === p.id ? ' is-active' : ''}`} onClick={() => pick(p.id)}>
                {p.name}
              </button>
            ))}
            {filtered.length === 0 && <div className="svb-combo-empty">No products match.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

export function VariationsBrowser() {
  const adminPath = useAdminPath()
  const currencySymbol = useCurrencySymbol()

  const [data, setData] = useState<VariationListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [columns, setColumns] = useState<VariationListColumn[]>([])

  const [productId, setProductId] = useState('')
  const [missing, setMissing] = useState('')
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => { setSearchDebounced(search); setPage(1) }, 250)
    return () => clearTimeout(t)
  }, [search])

  const refresh = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (productId) params.set('product', productId)
    if (missing) params.set('missing', missing)
    if (searchDebounced) params.set('search', searchDebounced)
    params.set('page', String(page))
    params.set('perPage', String(PER_PAGE))
    fetch(`/api/m/shop-variations/admin/variations?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: VariationListResult | null) => {
        if (!d) return
        setData(d)
        // Keep the column set even across a page that happens to have none, so the
        // header does not flicker as the owner pages through.
        if (d.columns.length > 0 || page === 1) setColumns(d.columns)
      })
      .finally(() => setLoading(false))
  }, [productId, missing, searchDebounced, page])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh() }, [refresh])

  const products = data?.products ?? []
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE))
  const firstOnPage = total === 0 ? 0 : (page - 1) * PER_PAGE + 1
  const lastOnPage = Math.min(page * PER_PAGE, total)
  const hasFilters = Boolean(productId || missing || searchDebounced)

  // "Missing" options: image is always offered; a contributed column (the 3D file,
  // each attribute) is offered once it is known to exist.
  const missingOptions = useMemo(
    () => [{ id: 'image', label: 'Image' }, ...columns.map((c) => ({ id: c.id, label: c.label }))],
    [columns],
  )

  function clearFilters() { setProductId(''); setMissing(''); setSearch(''); setPage(1) }

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <div className="svb-toolbar">
        <ProductFilter products={products} value={productId} onChange={(id) => { setProductId(id); setPage(1) }} />
        <select className="svb-select" aria-label="Show only variations missing" value={missing} onChange={(e) => { setMissing(e.target.value); setPage(1) }}>
          <option value="">All variations</option>
          {missingOptions.map((o) => (
            <option key={o.id} value={o.id}>Without {o.label}</option>
          ))}
        </select>
        <input className="svb-search" aria-label="Search variations" placeholder="Search product or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {hasFilters && <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear</button>}
        {!loading && <span className="svb-count">{total} variation{total === 1 ? '' : 's'}</span>}
      </div>

      {loading && !data ? (
        <div className="svb-note">Loading variations…</div>
      ) : rows.length === 0 ? (
        <div className="svb-note">
          {hasFilters ? 'No variations match those filters.' : 'No variations yet. Open any product under Shop › Products and use its Variations tab to add some.'}
        </div>
      ) : (
        <div className="svb-wrap">
          <table className="svb-table">
            <thead>
              <tr>
                <th className="svb-imgcol" aria-label="Image" />
                <th>Product</th>
                <th>Variation</th>
                <th>SKU</th>
                <th>Price</th>
                <th>Stock</th>
                {columns.map((c) => <th key={c.id}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.variantId} row={r} columns={columns} adminPath={adminPath} currencySymbol={currencySymbol} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PER_PAGE && (
        <div className="svb-pager">
          <span className="svb-muted">Showing {firstOnPage}–{lastOnPage} of {total}</span>
          <div className="svb-pager-btns">
            <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span className="btn btn-ghost btn-sm" style={{ pointerEvents: 'none' }}>Page {page} of {pageCount}</span>
            <button className="btn btn-secondary btn-sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ row, columns, adminPath, currencySymbol }: {
  row: VariationListRow
  columns: VariationListColumn[]
  adminPath: string
  currencySymbol: string
}) {
  const onSale = isOnSale({ price: row.price, salePrice: row.salePrice })
  const stock = !row.trackInventory ? '—' : row.stockCount == null ? '—' : String(row.stockCount)
  return (
    <tr className={row.enabled ? '' : 'svb-disabled'}>
      <td className="svb-imgcol">
        {row.imageUrl
          // eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader
          ? <img className="svb-thumb" src={row.imageUrl} alt="" />
          : <div className="svb-thumb-empty" aria-hidden>▦</div>}
      </td>
      <td>
        <a className="svb-name" href={`/${adminPath}/m/shop/products/${row.productId}?tab=variations-inline`}>{row.productName}</a>
        {!row.enabled && <span className="badge badge-default" style={{ marginLeft: '0.5rem' }}>Disabled</span>}
      </td>
      <td>{row.label || <span className="svb-muted">—</span>}</td>
      <td className="svb-muted">{row.sku || '—'}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {formatMoney(onSale ? row.salePrice : row.price, currencySymbol)}
        {onSale && <span className="svb-was">{formatMoney(row.price, currencySymbol)}</span>}
      </td>
      <td>{stock}</td>
      {columns.map((c) => {
        const text = fieldDisplay(row.fields[c.id])
        return <td key={c.id}>{text || <span className="svb-muted">—</span>}</td>
      })}
    </tr>
  )
}

const css = `
.svb-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
.svb-search, .svb-select { padding: 0.4rem 0.6rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm, 6px); background: var(--color-input-bg, var(--color-bg)); color: var(--color-text); font: inherit; font-size: var(--text-sm, 0.875rem); }
.svb-search { flex: 1; min-width: 12rem; }
.svb-count { color: var(--color-text-muted); font-size: var(--text-sm, 0.875rem); margin-left: auto; }
.svb-muted { color: var(--color-text-muted); }
.svb-note { color: var(--color-text-muted); padding: 1.5rem 0; }
.svb-wrap { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius, 8px); }
.svb-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm, 0.875rem); }
.svb-table th, .svb-table td { text-align: left; padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; white-space: nowrap; }
.svb-table th { color: var(--color-text-muted); font-weight: 600; }
.svb-table tbody tr:last-child td { border-bottom: none; }
.svb-imgcol { width: 44px; padding-right: 0 !important; }
.svb-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: var(--radius-sm, 6px); display: block; }
.svb-thumb-empty { width: 36px; height: 36px; border-radius: var(--radius-sm, 6px); background: var(--color-surface-2, var(--color-bg)); color: var(--color-text-muted); display: flex; align-items: center; justify-content: center; }
.svb-name { color: var(--color-text); text-decoration: none; font-weight: 500; }
.svb-name:hover { text-decoration: underline; }
.svb-disabled { opacity: 0.6; }
.svb-was { margin-left: 0.4rem; color: var(--color-text-muted); text-decoration: line-through; }
.svb-pager { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 1rem; }
.svb-pager-btns { display: flex; align-items: center; gap: 0.5rem; }
.svb-combo { position: relative; }
.svb-combo-btn { display: inline-flex; align-items: center; gap: 0.5rem; min-width: 12rem; padding: 0.4rem 0.6rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm, 6px); background: var(--color-input-bg, var(--color-bg)); color: var(--color-text); font: inherit; font-size: var(--text-sm, 0.875rem); cursor: pointer; }
.svb-combo-caret { margin-left: auto; color: var(--color-text-muted); }
.svb-combo-panel { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; width: 16rem; max-width: 80vw; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius, 8px); box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15)); padding: 0.4rem; }
.svb-combo-search { width: 100%; padding: 0.4rem 0.6rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm, 6px); background: var(--color-input-bg, var(--color-bg)); color: var(--color-text); font: inherit; font-size: var(--text-sm, 0.875rem); margin-bottom: 0.4rem; }
.svb-combo-list { max-height: 16rem; overflow-y: auto; display: flex; flex-direction: column; }
.svb-combo-opt { text-align: left; padding: 0.4rem 0.6rem; border: none; background: none; color: var(--color-text); font: inherit; font-size: var(--text-sm, 0.875rem); cursor: pointer; border-radius: var(--radius-sm, 6px); }
.svb-combo-opt:hover { background: var(--color-surface-2, var(--color-bg-hover, rgba(127,127,127,0.12))); }
.svb-combo-opt.is-active { color: var(--color-primary); font-weight: 600; }
.svb-combo-empty { padding: 0.5rem 0.6rem; color: var(--color-text-muted); font-size: var(--text-sm, 0.875rem); }
`
