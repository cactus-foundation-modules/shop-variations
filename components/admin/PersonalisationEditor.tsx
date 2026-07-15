'use client'

import { useState } from 'react'
import type { SvrAddon, SvrAddonConfig, SvrAddonType } from '@/modules/shop-variations/lib/types'

const TYPE_LABELS: Record<SvrAddonType, string> = {
  TEXT: 'Short text', TEXTAREA: 'Long text', NUMBER: 'Number', SELECT: 'Dropdown',
  CHECKBOX: 'Checkbox', DATE: 'Date', FILE: 'File upload',
}

// Admin CRUD for a product's personalisation add-ons. Each field's config is
// type-specific (per-character pricing for text, priced choices for dropdowns,
// upload limits for files); the storefront controls and server pricing live in
// the module's line resolver.
export function PersonalisationEditor({ productId, addons, currency, onChange }: { productId: string; addons: SvrAddon[]; currency: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false)

  async function remove(id: string) {
    setBusy(true)
    await fetch(`/api/m/shop-variations/admin/addons/${id}`, { method: 'DELETE' })
    onChange(); setBusy(false)
  }

  return (
    <section style={{ display: 'grid', gap: '0.75rem' }}>
      <h2 style={{ fontSize: '1.125rem', margin: 0 }}>Personalisation</h2>
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
        Extra fields a shopper fills in - engraving text, gift messages, dropdowns, dates or artwork uploads. Prices are added on top of the variant price.
      </p>

      {addons.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
          {addons.map((a) => (
            <li key={a.id} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.625rem 0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <span>
                <strong>{a.label}</strong>{' '}
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                  {TYPE_LABELS[a.type]}{a.required ? ' · required' : ''}{describePrice(a.config, currency)}
                </span>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => remove(a.id)} disabled={busy}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <AddAddonForm productId={productId} currency={currency} onAdded={onChange} />
    </section>
  )
}

function describePrice(config: SvrAddonConfig, currency: string): string {
  const bits: string[] = []
  if (config.flatPrice) bits.push(`+${currency}${config.flatPrice}`)
  if (config.pricePerChar) bits.push(`+${currency}${config.pricePerChar}/char`)
  if (config.choices?.some((c) => c.price)) bits.push('priced choices')
  return bits.length ? ` · ${bits.join(', ')}` : ''
}

function AddAddonForm({ productId, currency, onAdded }: { productId: string; currency: string; onAdded: () => void }) {
  const [type, setType] = useState<SvrAddonType>('TEXT')
  const [label, setLabel] = useState('')
  const [required, setRequired] = useState(false)
  const [flatPrice, setFlatPrice] = useState('')
  const [pricePerChar, setPricePerChar] = useState('')
  const [maxLength, setMaxLength] = useState('')
  const [choices, setChoices] = useState('') // "Label | 5" per line
  const [maxFileMb, setMaxFileMb] = useState('')
  const [allowedTypes, setAllowedTypes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const input = { padding: '0.375rem 0.5rem', borderRadius: 6, border: '1px solid var(--color-border)' } as const

  function buildConfig(): SvrAddonConfig {
    const config: SvrAddonConfig = {}
    if (flatPrice) config.flatPrice = Number(flatPrice)
    if ((type === 'TEXT' || type === 'TEXTAREA')) {
      if (pricePerChar) config.pricePerChar = Number(pricePerChar)
      if (maxLength) config.maxLength = Number(maxLength)
    }
    if (type === 'SELECT') {
      config.choices = choices.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const parts = line.split('|')
        const lbl = (parts[0] ?? '').trim()
        const price = parts[1]?.trim()
        return { label: lbl, value: lbl, ...(price ? { price: Number(price) } : {}) }
      })
    }
    if (type === 'FILE') {
      if (maxFileMb) config.maxFileMb = Number(maxFileMb)
      if (allowedTypes) config.allowedTypes = allowedTypes.trim()
    }
    return config
  }

  async function submit() {
    if (!label.trim()) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/addons`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, label: label.trim(), required, config: buildConfig() }),
    })
    if (res.ok) {
      setLabel(''); setRequired(false); setFlatPrice(''); setPricePerChar(''); setMaxLength(''); setChoices(''); setMaxFileMb(''); setAllowedTypes('')
      onAdded()
    } else {
      setError((await res.json()).error ?? 'Could not add field')
    }
    setBusy(false)
  }

  return (
    <div style={{ border: '1px dashed var(--color-border)', borderRadius: 8, padding: '0.75rem 1rem', display: 'grid', gap: '0.5rem' }}>
      <strong style={{ fontSize: '0.875rem' }}>Add a personalisation field</strong>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={type} onChange={(e) => setType(e.target.value as SvrAddonType)} style={{ ...input, width: 150 }}>
          {(Object.keys(TYPE_LABELS) as SvrAddonType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        <input placeholder="Label (e.g. Engraving)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...input, flex: 1, minWidth: 180 }} />
        <label style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center', fontSize: '0.875rem' }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8125rem' }}>
        <label style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
          Surcharge {currency}<input type="number" min={0} step="0.01" value={flatPrice} onChange={(e) => setFlatPrice(e.target.value)} style={{ ...input, width: 80 }} />
        </label>
        {(type === 'TEXT' || type === 'TEXTAREA') && (
          <>
            <label style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
              Per character {currency}<input type="number" min={0} step="0.01" value={pricePerChar} onChange={(e) => setPricePerChar(e.target.value)} style={{ ...input, width: 80 }} />
            </label>
            <label style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
              Max length <input type="number" min={1} step="1" value={maxLength} onChange={(e) => setMaxLength(e.target.value)} style={{ ...input, width: 80 }} />
            </label>
          </>
        )}
        {type === 'FILE' && (
          <>
            <label style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
              Max MB <input type="number" min={1} step="1" value={maxFileMb} onChange={(e) => setMaxFileMb(e.target.value)} style={{ ...input, width: 70 }} />
            </label>
            <input placeholder="Allowed types (image/png,application/pdf)" value={allowedTypes} onChange={(e) => setAllowedTypes(e.target.value)} style={{ ...input, minWidth: 220 }} />
          </>
        )}
      </div>

      {type === 'SELECT' && (
        <textarea
          placeholder={`One choice per line, optional price after a pipe:\nSmall\nLarge | 5`}
          value={choices} onChange={(e) => setChoices(e.target.value)} rows={3}
          style={{ ...input, fontFamily: 'inherit', resize: 'vertical' }}
        />
      )}

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy || !label.trim()}>Add field</button>
        {error && <span style={{ color: 'var(--color-danger)', fontSize: '0.8125rem' }}>{error}</span>}
      </div>
    </div>
  )
}
