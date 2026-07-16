'use client'

// The components that fill shop's `shop.product-detail-parts` slot, so a shop
// whose product has options is buyable straight out of the box - no layout
// editing, no blocks to drag in.
//
// These differ from VariantParts.tsx (the granular blocks a layout author drops
// in by hand, which bring their own styling). Here shop hands us its own class
// names and its server-loaded product data, and we render into them: the shopper
// sees the layout's gallery, price and buy row, quietly made variant-aware. All
// selection state comes from the same store the granular parts use, so the two
// stay in step if both end up on one page.
import { useEffect, useState } from 'react'
import { useVariationSelection } from '@/modules/shop-variations/lib/use-variation-selection'
import type {
  ShopDetailGallerySlotProps,
  ShopDetailPriceSlotProps,
  ShopDetailPurchaseSlotProps,
} from '@/modules/shop/lib/detail-slot'
import { AddonControl, OptionControl } from '@/modules/shop-variations/components/public/VariantParts'

const money = (n: number, symbol: string) => `${symbol}${n.toFixed(2)}`

// ---- Gallery -------------------------------------------------------------
// Shop's images render immediately from its server data; once a chosen variant
// carries its own image we lead with that.
export function VariantSlotGallery({ slug, productName, images, shape, classNames }: ShopDetailGallerySlotProps) {
  const sel = useVariationSelection(slug)
  const [override, setOverride] = useState<string | null>(null)
  const variantImage = sel.variant?.imageUrl ?? null

  // A new variant image resets the shopper's manual thumbnail pick.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the override in response to a variant change is the intended reset, not derived render state
  useEffect(() => { setOverride(null) }, [variantImage])

  const aspect = shape === 'portrait' ? '3 / 4' : shape === 'landscape' ? '4 / 3' : '1 / 1'
  const thumbs = [...(variantImage ? [{ url: variantImage, alt: productName }] : []), ...images]
    .filter((t, i, arr) => arr.findIndex((x) => x.url === t.url) === i)
  const main = override ?? variantImage ?? images[0]?.url ?? null

  return (
    <div className={classNames.col}>
      <div className={classNames.stage} style={{ aspectRatio: aspect }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- mirrors shop's own gallery, which serves already-sized media URLs */}
        {main && <img className={classNames.image} src={main} alt={productName} />}
      </div>
      {thumbs.length > 1 && (
        <div className={classNames.thumbs}>
          {thumbs.map((t) => (
            <button
              key={t.url} type="button" onClick={() => setOverride(t.url)}
              className={main === t.url ? classNames.thumbOn : classNames.thumb}
              aria-label={`Show ${t.alt}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
              <img src={t.url} alt={t.alt} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Price ---------------------------------------------------------------
export function VariantSlotPrice({ slug, basePrice, compareAtPrice, savePct, currencySymbol, classNames }: ShopDetailPriceSlotProps) {
  const sel = useVariationSelection(slug)
  const base = Number(basePrice)
  // Shop's own price until the selection resolves, so the figure never blanks.
  const live = sel.loaded && sel.payload ? sel.price : base
  // "Was"/"Save" are the parent's, measured against the parent's price. The
  // moment a choice moves the price off that, they'd be a saving against a
  // number nobody is being charged, so they go.
  const atBase = Math.abs(live - base) < 0.005
  const symbol = sel.loaded && sel.payload ? sel.currencySymbol : currencySymbol

  return (
    <div className={classNames.block}>
      <span className={classNames.now}>{money(live, symbol)}</span>
      {atBase && compareAtPrice && <span className={classNames.was}>{money(Number(compareAtPrice), symbol)}</span>}
      {atBase && savePct != null && savePct > 0 && <span className={classNames.save}>Save {savePct}%</span>}
    </div>
  )
}

// ---- Purchase area -------------------------------------------------------
// Shop's buy row, plus the option controls and personalisation fields above it.
// This owns availability for a claimed product: stock lives on the chosen
// combination, not on the parent row shop can see.
export function VariantSlotPurchase({ slug, showStepper, label, classNames, layoutBlockTypes }: ShopDetailPurchaseSlotProps) {
  const sel = useVariationSelection(slug)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  // Options and personalisation ride along in this slot because shop has no part
  // of its own for them. When the author has already placed our granular block
  // for either, that block owns it and we must not draw it a second time - the
  // shopper would get two option pickers wired to the same selection.
  const optionsPlaced = layoutBlockTypes.includes('ShopVariantOptions')
  const addonsPlaced = layoutBlockTypes.includes('ShopVariantPersonalisation')

  // Until the selection loads we still render the buy row, with the button held
  // disabled. Returning null here instead would blink the page's main call to
  // action out of existence on first paint, which shop's own server-rendered
  // button never did.
  if (!sel.loaded || !sel.payload) {
    return (
      <div className={classNames.row}>
        <button type="button" className={classNames.add} disabled>{label}</button>
      </div>
    )
  }

  const reason = !sel.allOptionsChosen ? 'Choose your options'
    : sel.hasOptions && !sel.inStock ? 'Out of stock'
    : !sel.addonPricing.valid ? (sel.addonPricing.reason ?? 'Complete the required fields')
    : null

  return (
    <div>
      {!optionsPlaced && sel.payload.options.length > 0 && (
        <div style={{ display: 'grid', gap: '1rem', marginTop: '18px' }}>
          {sel.payload.options.map((option) => (
            <OptionControl key={option.id} option={option} sel={sel} />
          ))}
        </div>
      )}
      {!addonsPlaced && sel.payload.addons.length > 0 && (
        <div style={{ display: 'grid', gap: '0.875rem', marginTop: '18px' }}>
          {sel.payload.addons.map((addon) => (
            <AddonControl
              key={addon.id} addon={addon} value={sel.addonValues[addon.id]}
              onChange={(v) => sel.setAddon(addon.id, v)} currency={sel.currencySymbol} slug={slug}
            />
          ))}
        </div>
      )}

      <div className={classNames.row}>
        {showStepper && (
          <div className={classNames.stepper}>
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Decrease quantity">−</button>
            <input
              type="text" inputMode="numeric" value={qty} aria-label="Quantity"
              onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))}
            />
            <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Increase quantity">+</button>
          </div>
        )}
        <button
          type="button" className={classNames.add} disabled={!sel.canAdd}
          onClick={() => { if (sel.add(qty)) { setAdded(true); window.setTimeout(() => setAdded(false), 2000) } }}
        >
          {added ? 'Added ✓' : label}
        </button>
      </div>
      {reason && <p className={classNames.outOfStock}>{reason}</p>}
    </div>
  )
}
