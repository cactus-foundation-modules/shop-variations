'use client'

import { useEffect, useState } from 'react'
import { OPTIONS_AREA_CLASS } from '@/modules/shop-variations/lib/use-sticky-mobile-gallery'
import { useVariationSelection } from '@/modules/shop-variations/lib/use-variation-selection'
import { useProductSlug } from '@/modules/shop-variations/lib/use-product-slug'
import type { AddonValue, AddonFileValue } from '@/modules/shop-variations/lib/addon-pricing'
import type { ShopGalleryExtra } from '@/modules/shop/lib/gallery-media'
import type { SvrAddon, SvrOptionWithValues, VariationBootstrap } from '@/modules/shop-variations/lib/types'

// On the live page each part is handed the slug and the payload its RSC half
// already resolved, so the controls are in the server's HTML from the off.
// Failing that (a layout we can't identify the product from server-side) a part
// still resolves the slug from the URL after mount and fetches, so one dropped
// somewhere unexpected keeps working - all parts on a page land on the same slug
// and therefore share one selection store entry either way.
type PartProps = { preview?: boolean; slug?: string | null; initial?: VariationBootstrap | null }

// Where an option's name sits relative to its choices. 'above' is the long-standing
// look and stays the default everywhere; 'beside' is opt-in per block, for narrow
// columns where a stack of name-then-choices runs the page long.
export type OptionLabelPlacement = 'above' | 'beside'

// Reusable storefront parts. Each takes the product slug and reads the shared
// selection store, so they stay in sync whether composed together (the composite
// block) or dropped independently (the granular Product Detail parts).

function Skeleton({ label }: { label: string }) {
  return (
    <div style={{ border: '1px dashed var(--color-border)', borderRadius: 8, padding: '0.75rem 1rem', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
      {label} (shown on the live product page)
    </div>
  )
}

const money = (n: number, symbol: string) => `${symbol}${n.toFixed(2)}`

// ---- Options -------------------------------------------------------------
export function VariantOptionsPart({ preview, slug: explicitSlug, initial, labelPlacement }: PartProps & { labelPlacement?: OptionLabelPlacement }) {
  const slug = useProductSlug(explicitSlug ?? null)
  const sel = useVariationSelection(slug, initial)
  // The skeleton is the editor's placeholder and belongs nowhere near a shopper:
  // on the live page an unresolved slug renders nothing at all until it resolves.
  if (preview) return <Skeleton label="Variant options" />
  if (!slug || !sel.loaded) return null
  if (!sel.payload || sel.payload.options.length === 0) return null

  return (
    // The class marks the option pickers' extent for the pinned mobile gallery
    // (lib/use-sticky-mobile-gallery.ts); it carries no styling.
    <div className={OPTIONS_AREA_CLASS} style={{ display: 'grid', gap: '1rem' }}>
      {sel.payload.options.map((option, index) => (
        sel.isOptionVisible(index) ? <OptionControl key={option.id} option={option} sel={sel} labelPlacement={labelPlacement} /> : null
      ))}
    </div>
  )
}

// Sits alongside the live price, in both hosts (see DetailSlotPartsClient), and
// puts the shopper back to an unchosen page. Both hosts lay their price out as a
// baseline-aligned flex row, so the gap that holds it clear of the figure is the
// control's own - one control, one look, wherever the price happens to be.
// A button rather than an anchor: it goes nowhere, and a keyboard or screen
// reader shopper should be told as much.
export function ResetOptionsLink({ sel }: { sel: ReturnType<typeof useVariationSelection> }) {
  if (!sel.anyOptionChosen) return null
  return (
    <button
      type="button" onClick={() => sel.resetOptions()}
      style={{
        marginLeft: '2.5rem', padding: 0, background: 'none', border: 'none',
        color: 'var(--color-text-muted)', fontFamily: 'inherit', fontSize: '0.8125rem',
        fontWeight: 400, whiteSpace: 'nowrap',
        textDecoration: 'underline', cursor: 'pointer',
      }}
    >
      Reset options
    </button>
  )
}

// Exported so the slot parts (DetailSlotParts.tsx) render the identical control
// inside shop's own detail chrome - one control, two hosts.
export function OptionControl({ option, sel, labelPlacement = 'above' }: { option: SvrOptionWithValues; sel: ReturnType<typeof useVariationSelection>; labelPlacement?: OptionLabelPlacement }) {
  const chosen = sel.optionValues[option.id]
  // A pick an upstream change has just made unreachable: shown struck through
  // and disabled rather than dropped, so the shopper sees it was there and why
  // it no longer fits. Null when the current pick still fits (or there isn't one).
  const ghost = sel.ghostValue(option.id)
  const unavailableTitle = (v: SvrOptionWithValues['values'][number]) => {
    const clash = sel.unavailableWith(option.id, v.id)
    return clash ? `Not available with ${clash}` : `${v.label} - unavailable`
  }
  // Beside: the name and its choices share a row, so the gap under the name goes
  // and the row takes over spacing them. It still wraps to two lines on a narrow
  // column rather than crushing a swatch row into the margin.
  const beside = labelPlacement === 'beside'
  const label = (
    <span style={{ fontWeight: 600, fontSize: '0.875rem', display: 'block', marginBottom: beside ? 0 : '0.375rem', flexShrink: 0 }}>
      {option.name}
    </span>
  )
  const rowStyle = beside
    ? { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' as const }
    : undefined

  if (option.controlType === 'DROPDOWN') {
    return (
      <label style={rowStyle}>
        {label}
        <select
          value={chosen ?? ''} onChange={(e) => sel.setOption(option.id, e.target.value)}
          style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', minWidth: 180, background: 'var(--color-surface)', color: 'var(--color-text)' }}
        >
          <option value="" disabled>Choose {option.name.toLowerCase()}</option>
          {/* An unbuyable combination is left out rather than shown greyed, so
              the shopper never meets a dead end they can pick. The exceptions are
              the current pick and a pick an upstream change has just stranded
              (the ghost): both stay listed, disabled and flagged unavailable, so
              the control never blanks out under the shopper. */}
          {option.values.filter((v) => sel.isAvailable(option.id, v.id) || chosen === v.id || ghost === v.id).map((v) => {
            const available = sel.isAvailable(option.id, v.id)
            return <option key={v.id} value={v.id} disabled={!available} title={available ? undefined : unavailableTitle(v)}>{v.label}{available ? '' : ' - unavailable'}</option>
          })}
        </select>
      </label>
    )
  }

  // SWATCH, IMAGE and PILL all render as a row of buttons. SWATCH adds a colour
  // dot, IMAGE a thumbnail; both keep the label alongside, because a picture of a
  // fabric answers "which one is that?" and the label answers "what is it called?"
  // - and a shopper who cannot see the picture is left with only the second.
  const isSwatch = option.controlType === 'SWATCH'
  const isImage = option.controlType === 'IMAGE'
  return (
    <div style={rowStyle}>
      {label}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {/* Unbuyable values drop out of the row entirely, so the shopper only ever
            sees choices that lead somewhere. Two stay put: the current pick, and a
            pick an upstream change has just stranded (the ghost) - both shown as a
            struck-through, disabled button rather than letting the row empty out. */}
        {option.values.filter((v) => sel.isAvailable(option.id, v.id) || chosen === v.id || ghost === v.id).map((v) => {
          const available = sel.isAvailable(option.id, v.id)
          const active = chosen === v.id
          return (
            <button
              key={v.id} type="button" disabled={!available}
              onClick={() => sel.setOption(option.id, v.id)}
              title={available ? v.label : unavailableTitle(v)}
              aria-pressed={active}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                padding: isSwatch || isImage ? '0.375rem 0.5rem' : '0.375rem 0.75rem',
                borderRadius: 999,
                border: `2px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: active ? 'var(--color-bg-subtle)' : 'var(--color-surface)',
                color: 'var(--color-text)',
                cursor: available ? 'pointer' : 'not-allowed',
                opacity: available ? 1 : 0.4,
                textDecoration: available ? 'none' : 'line-through',
                fontSize: '0.875rem',
              }}
            >
              {isSwatch && v.swatch && <span aria-hidden style={{ width: 16, height: 16, borderRadius: 999, background: v.swatch, border: '1px solid var(--color-border)' }} />}
              {isImage && v.swatch && <ImageSwatchThumb src={v.swatch} />}
              {v.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// The thumbnail beside an image-swatch value doubles as a peek control: hover it
// and the full picture pops above at 200x200, so a shopper can see the fabric
// properly before choosing. The thumbnail sits inside the value's selecting
// button, so a click on the picture chooses it just like a click on the label -
// the peek is a pure hover affordance and never swallows the click.
function ImageSwatchThumb({ src }: { src: string }) {
  const [open, setOpen] = useState(false)

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader */}
      <img src={src} alt="" aria-hidden style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', display: 'block', border: '1px solid var(--color-border)' }} />
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
            zIndex: 20, padding: 4, background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 8, boxShadow: 'var(--shadow-lg)', pointerEvents: 'none',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader */}
          <img src={src} alt="" aria-hidden style={{ width: 200, height: 200, objectFit: 'contain', display: 'block', borderRadius: 4 }} />
        </span>
      )}
    </span>
  )
}

// ---- Personalisation -----------------------------------------------------
export function VariantPersonalisationPart({ preview, slug: explicitSlug, initial }: PartProps) {
  const slug = useProductSlug(explicitSlug ?? null)
  const sel = useVariationSelection(slug, initial)
  if (preview) return <Skeleton label="Personalisation fields" />
  if (!slug || !sel.loaded) return null
  if (!sel.payload || sel.payload.addons.length === 0) return null

  return (
    <div style={{ display: 'grid', gap: '0.875rem' }}>
      {sel.payload.addons.map((addon) => (
        <AddonControl key={addon.id} addon={addon} value={sel.addonValues[addon.id]} onChange={(v) => sel.setAddon(addon.id, v)} currency={sel.currencySymbol} slug={slug} />
      ))}
    </div>
  )
}

// Exported alongside OptionControl for the same reason.
export function AddonControl({ addon, value, onChange, currency, slug }: { addon: SvrAddon; value: AddonValue; onChange: (v: AddonValue) => void; currency: string; slug: string }) {
  const priceHint = addon.config.flatPrice ? ` (+${money(addon.config.flatPrice, currency)})`
    : addon.config.pricePerChar ? ` (+${money(addon.config.pricePerChar, currency)}/character)` : ''
  const labelEl = (
    <span style={{ fontWeight: 600, fontSize: '0.875rem', display: 'block', marginBottom: '0.375rem' }}>
      {addon.label}{addon.required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
      {priceHint && <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>{priceHint}</span>}
    </span>
  )
  const field = { padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', width: '100%', background: 'var(--color-surface)', color: 'var(--color-text)' } as const
  const str = typeof value === 'string' ? value : ''

  return (
    <label style={{ display: 'block' }}>
      {labelEl}
      {addon.config.helpText && <span style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>{addon.config.helpText}</span>}
      {addon.type === 'TEXT' && <input value={str} maxLength={addon.config.maxLength} placeholder={addon.config.placeholder} onChange={(e) => onChange(e.target.value)} style={field} />}
      {addon.type === 'TEXTAREA' && <textarea value={str} maxLength={addon.config.maxLength} placeholder={addon.config.placeholder} rows={3} onChange={(e) => onChange(e.target.value)} style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }} />}
      {addon.type === 'NUMBER' && <input type="number" value={str} min={addon.config.min} max={addon.config.max} onChange={(e) => onChange(e.target.value)} style={field} />}
      {addon.type === 'DATE' && <input type="date" value={str} onChange={(e) => onChange(e.target.value)} style={field} />}
      {addon.type === 'CHECKBOX' && (
        <label style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', fontWeight: 400 }}>
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {addon.config.placeholder || 'Yes'}
        </label>
      )}
      {addon.type === 'SELECT' && (
        <select value={str} onChange={(e) => onChange(e.target.value)} style={field}>
          <option value="">Choose…</option>
          {addon.config.choices?.map((c) => (
            <option key={c.value} value={c.value}>{c.label}{c.price ? ` (+${money(c.price, currency)})` : ''}</option>
          ))}
        </select>
      )}
      {addon.type === 'FILE' && <FileUpload addon={addon} value={value as AddonFileValue | undefined} onChange={onChange} slug={slug} />}
    </label>
  )
}

function FileUpload({ addon, value, onChange, slug }: { addon: SvrAddon; value: AddonFileValue | undefined; onChange: (v: AddonValue) => void; slug: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true); setError(null)
    const form = new FormData()
    form.append('file', file)
    form.append('slug', slug)
    form.append('addonId', addon.id)
    try {
      const res = await fetch('/api/m/shop-variations/public/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (res.ok) onChange({ token: data.token, filename: data.filename, url: data.url })
      else setError(data.error ?? 'Upload failed')
    } catch {
      setError('Upload failed')
    }
    setBusy(false)
  }

  return (
    <div>
      {value?.filename ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>📎 {value.filename}</span>
          <button type="button" onClick={() => onChange(null)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}>Remove</button>
        </div>
      ) : (
        <input type="file" accept={addon.config.allowedTypes} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} />
      )}
      {busy && <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Uploading…</span>}
      {error && <span style={{ fontSize: '0.8125rem', color: 'var(--color-danger)' }}>{error}</span>}
    </div>
  )
}

// ---- Live price ----------------------------------------------------------
export function VariantPricePart({ preview, slug: explicitSlug, initial }: PartProps) {
  const slug = useProductSlug(explicitSlug ?? null)
  const sel = useVariationSelection(slug, initial)
  if (preview) return <Skeleton label="Variant price" />
  if (!slug || !sel.loaded || !sel.payload) return null
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem', fontSize: '1.5rem', fontWeight: 700 }}>
      <span>{money(sel.price, sel.currencySymbol)}</span>
      {/* Only once there's a combination to be out of stock. Nothing chosen is
          not the same as nothing available, and saying so over the parent's
          price would turn every options product into a sold-out one. */}
      {sel.hasOptions && sel.allOptionsChosen && !sel.inStock && <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--color-danger)' }}>Out of stock</span>}
      <ResetOptionsLink sel={sel} />
    </div>
  )
}

// ---- Add to cart ---------------------------------------------------------
export function VariantAddToCartPart({ preview, slug: explicitSlug, initial, label }: PartProps & { label?: string }) {
  const slug = useProductSlug(explicitSlug ?? null)
  const sel = useVariationSelection(slug, initial)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  if (preview) return <Skeleton label="Add to cart" />
  if (!slug || !sel.loaded || !sel.payload) return null

  const reason = !sel.allOptionsChosen ? 'Choose your options'
    : sel.hasOptions && !sel.inStock ? 'Out of stock'
    : !sel.addonPricing.valid ? (sel.addonPricing.reason ?? 'Complete the required fields')
    : null

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <input
          type="number" min={1} value={qty} aria-label="Quantity"
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 64, padding: '0.5rem', borderRadius: 6, border: '1px solid var(--color-border)' }}
        />
        <button
          type="button" disabled={!sel.canAdd}
          onClick={() => { if (sel.add(qty)) { setAdded(true); window.setTimeout(() => setAdded(false), 2000) } }}
          style={{
            flex: 1, background: sel.canAdd ? 'var(--color-primary)' : 'var(--color-bg-subtle)',
            color: sel.canAdd ? 'var(--color-on-primary)' : 'var(--color-text-muted)',
            border: 'none', borderRadius: 8, padding: '0.75rem 1.25rem', fontWeight: 600,
            cursor: sel.canAdd ? 'pointer' : 'not-allowed',
          }}
        >
          {added ? 'Added ✓' : (label || 'Add to cart')}
        </button>
      </div>
      {reason && <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{reason}</p>}
    </div>
  )
}

// ---- Variant-aware gallery ----------------------------------------------
// `extras` are items another module contributed through shop's `shop.gallery-media`
// point, resolved by this block's RSC half. This block covers shop's Gallery slot,
// so it is the only strip on the page and owns showing them - see the note in
// variant-parts.rsc.tsx.
export function VariantGalleryPart({ preview, slug: explicitSlug, initial, extras = [] }: PartProps & { extras?: ShopGalleryExtra[] }) {
  const slug = useProductSlug(explicitSlug ?? null)
  const sel = useVariationSelection(slug, initial)
  const [override, setOverride] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ id: string; key: string } | null>(null)
  const variantImage = sel.variant?.imageUrl ?? null

  // When the chosen variant brings its own image, snap the main view to it.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the manual thumbnail override in response to a variant change is the intended reset, not derived render state
  useEffect(() => { setOverride(null) }, [variantImage])

  if (preview) return <Skeleton label="Variant gallery" />
  if (!slug || !sel.loaded || !sel.payload) return null

  const base = sel.payload.baseImages
  const main = override ?? sel.image ?? base[0]?.url ?? null
  const thumbs = [...(variantImage ? [{ url: variantImage, alt: 'Selected variant' }] : []), ...base]
    .filter((t, i, arr) => arr.findIndex((x) => x.url === t.url) === i)
  const activeExtra = picked ? extras.find((e) => e.id === picked.id) ?? null : null
  const activeProductId = sel.variant?.childProductId ?? null

  // A product whose only picture is a contributed item still has a gallery worth
  // drawing, so this bails only when there is nothing at all to show.
  if (!main && extras.length === 0) return null
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {/* This block styles itself inline, but a contributed thumbnail is rendered
          by the module that supplied it and can only be handed class names. These
          two mirror the image thumbnails' inline style above, so a 3D thumbnail
          sits in the strip looking like the pictures either side of it rather
          than like an unstyled button. */}
      {extras.length > 0 && (
        <style dangerouslySetInnerHTML={{ __html: `
.svr-gallery-thumb{padding:0;border:2px solid var(--color-border);border-radius:8px;cursor:pointer;background:none;width:56px;height:56px;overflow:hidden;display:block;position:relative}
.svr-gallery-thumb.on{border-color:var(--color-primary)}
` }} />
      )}
      {activeExtra && picked ? (
        <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
          <activeExtra.Stage payload={activeExtra.payload} itemKey={picked.key} activeProductId={activeProductId} />
        </div>
      ) : main ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={main} alt={sel.payload.productName} style={{ width: '100%', borderRadius: 10, objectFit: 'cover', aspectRatio: '1 / 1', border: '1px solid var(--color-border)' }} />
      ) : null}
      {thumbs.length + extras.length > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Contributed media (a 3D model, say) leads the strip, so the richer
              view sits first rather than trailing behind the photos - it is also
              what the stage opens on, and the two should agree. */}
          {extras.map((extra) => (
            <extra.Thumbs
              key={extra.id}
              payload={extra.payload}
              activeProductId={activeProductId}
              activeKey={picked?.id === extra.id ? picked.key : null}
              onPick={(key) => setPicked(key === null ? null : { id: extra.id, key })}
              thumbClass="svr-gallery-thumb"
              thumbOnClass="svr-gallery-thumb on"
            />
          ))}
          {thumbs.map((t) => (
            <button key={t.url} type="button" onClick={() => { setOverride(t.url); setPicked(null) }} style={{ padding: 0, border: `2px solid ${main === t.url && !picked ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 8, cursor: 'pointer', background: 'none' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.url} alt={t.alt} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
